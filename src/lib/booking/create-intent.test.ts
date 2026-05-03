import { describe, it, expect, vi, beforeEach } from 'vitest'

const paymentIntentsCreate = vi.fn()
const getAvailabilityDetail = vi.fn()
const supabaseFrom = vi.fn()

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    paymentIntents: { create: paymentIntentsCreate },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: async () => ({
    from: supabaseFrom,
  }),
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    getAvailabilityDetail,
  }),
}))

import { createPaymentIntent } from './create-intent'

const baseInput = {
  baseAmountCents: 40000,
  listingId: 'listing-1',
  listingTitle: 'Curaçao Hidden Gems',
  availPk: 11111,
  customerTypeRatePk: 22222,
  guestCount: 2,
  category: 'private',
  date: '2026-05-14',
  contact: { name: 'Beer', email: 'beer@example.com', phone: '+31600000000' },
  selectedExtraIds: [],
  durationMinutes: 120,
}

beforeEach(() => {
  paymentIntentsCreate.mockReset()
  getAvailabilityDetail.mockReset()
  supabaseFrom.mockReset()

  paymentIntentsCreate.mockResolvedValue({ client_secret: 'pi_secret_test' })

  // No extras selected → DB query never runs, but mock it defensively
  supabaseFrom.mockReturnValue({
    select: () => ({
      in: () => ({
        eq: () => Promise.resolve({ data: [] }),
      }),
    }),
  })
})

describe('createPaymentIntent — FareHarbor net vs gross', () => {
  it('charges the gross (total_including_tax) price, NOT the net (total)', async () => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        {
          pk: 22222,
          customer_prototype: {
            total: 36697,                 // NET (ex-9%-VAT)
            total_including_tax: 40000,   // GROSS
          },
        },
      ],
    })

    await createPaymentIntent(baseInput)

    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    const args = paymentIntentsCreate.mock.calls[0][0]
    // Must charge €400.00 gross + €5.20 city tax (2 guests × €2.60) = €405.20
    expect(args.amount).toBe(40520)
  })

  it('falls back to total when total_including_tax is missing', async () => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        {
          pk: 22222,
          customer_prototype: {
            total: 40000, // legacy / non-tax-bearing — treat as gross
          },
        },
      ],
    })

    await createPaymentIntent(baseInput)

    const args = paymentIntentsCreate.mock.calls[0][0]
    // €400.00 base + €5.20 city tax (2 guests × €2.60)
    expect(args.amount).toBe(40520)
  })

  it('falls back to client baseAmountCents when FareHarbor has no matching rate', async () => {
    getAvailabilityDetail.mockResolvedValue({ customer_type_rates: [] })

    await createPaymentIntent(baseInput)

    const args = paymentIntentsCreate.mock.calls[0][0]
    // €400.00 base + €5.20 city tax (2 guests × €2.60)
    expect(args.amount).toBe(40520)
  })

  it('adds €2.60/guest city tax for all cruise types (shared and private)', async () => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        {
          pk: 22222,
          customer_prototype: { total: 9000, total_including_tax: 10000 },
        },
      ],
    })

    await createPaymentIntent({ ...baseInput, category: 'shared', guestCount: 4 })

    const args = paymentIntentsCreate.mock.calls[0][0]
    // shared: per-guest gross 10000 × 4 = 40000, + city tax 4 × 260 = 1040 → 41040
    expect(args.amount).toBe(41040)
  })

  it('adds €2.60/guest city tax for private cruises', async () => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        {
          pk: 22222,
          customer_prototype: { total: 36697, total_including_tax: 40000 },
        },
      ],
    })

    await createPaymentIntent({ ...baseInput, category: 'private', guestCount: 4 })

    const args = paymentIntentsCreate.mock.calls[0][0]
    // private: flat boat price 40000 + city tax 4 × 260 = 1040 → 41040
    expect(args.amount).toBe(41040)
  })
})
