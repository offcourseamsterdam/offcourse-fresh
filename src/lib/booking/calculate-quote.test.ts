import { describe, it, expect, vi, beforeEach } from 'vitest'

const getAvailabilityDetail = vi.fn()
const supabaseFrom = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: supabaseFrom,
  }),
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    getAvailabilityDetail,
  }),
}))

import { calculateQuote } from './calculate-quote'

const baseInput = {
  listingId: 'listing-1',
  availPk: 11111,
  customerTypeRatePk: 22222,
  guestCount: 2,
  category: 'private',
  durationMinutes: 120,
  selectedExtraIds: [],
  extraQuantities: {},
}

const noExtrasFromDb = {
  select: () => ({
    in: () => ({
      eq: () => Promise.resolve({ data: [] }),
    }),
  }),
}

beforeEach(() => {
  getAvailabilityDetail.mockReset()
  supabaseFrom.mockReset()
  supabaseFrom.mockReturnValue(noExtrasFromDb)
})

// ── FareHarbor price source (gross vs net) ─────────────────────────────────

describe('calculateQuote — FareHarbor price source', () => {
  it('uses total_including_tax (gross) — never the net total', async () => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        {
          pk: 22222,
          customer_prototype: { total: 36697, total_including_tax: 40000 },
        },
      ],
    })

    const result = await calculateQuote(baseInput)

    expect(result.basePriceCents).toBe(40000)
    // Private with 2 guests: 40000 (boat) + 520 (city tax 2×260)
    expect(result.totalCents).toBe(40520)
  })

  it('falls back to total when total_including_tax is absent', async () => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        { pk: 22222, customer_prototype: { total: 40000 } },
      ],
    })

    const result = await calculateQuote(baseInput)

    expect(result.basePriceCents).toBe(40000)
    expect(result.totalCents).toBe(40520)
  })

  it('throws when no matching rate exists (refuses to charge €0)', async () => {
    getAvailabilityDetail.mockResolvedValue({ customer_type_rates: [] })

    await expect(calculateQuote(baseInput)).rejects.toThrow(/Could not verify price/)
  })
})

// ── City tax (€2.60/guest, all cruise types) ───────────────────────────────

describe('calculateQuote — city tax', () => {
  beforeEach(() => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        { pk: 22222, customer_prototype: { total_including_tax: 10000 } },
      ],
    })
  })

  it('adds €2.60 × guests for shared cruises', async () => {
    const result = await calculateQuote({ ...baseInput, category: 'shared', guestCount: 4 })

    // shared: per-guest 10000 × 4 = 40000 base + 1040 city tax = 41040
    expect(result.cityTaxCents).toBe(1040)
    expect(result.totalCents).toBe(41040)
  })

  it('adds €2.60 × guests for private cruises (regression — was bug pre-23fd1b9)', async () => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        { pk: 22222, customer_prototype: { total_including_tax: 40000 } },
      ],
    })

    const result = await calculateQuote({ ...baseInput, category: 'private', guestCount: 4 })

    // private: flat 40000 + 1040 city tax = 41040
    expect(result.cityTaxCents).toBe(1040)
    expect(result.totalCents).toBe(41040)
  })
})

// ── Per-person-per-hour extras (Sophie's case) ─────────────────────────────

describe('calculateQuote — Unlimited Bar drift scenario', () => {
  it('reproduces Sophie: €45 of Unlimited Bar = 3 guests × 1.5h × €10', async () => {
    // Curaçao private @ €100, 4 guests, 1.5h cruise
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        { pk: 22222, customer_prototype: { total_including_tax: 14300 } },
      ],
    })

    const unlimitedBar = {
      id: 'bar-id',
      name: 'Unlimited Bar',
      category: 'drinks',
      price_type: 'per_person_per_hour_cents',
      price_value: 1000,
      vat_rate: 21,
      is_required: false,
      quantity_mode: 'toggle',
    }

    supabaseFrom.mockReturnValue({
      select: () => ({
        in: () => ({
          eq: () => Promise.resolve({ data: [unlimitedBar] }),
        }),
      }),
    })

    const result = await calculateQuote({
      ...baseInput,
      guestCount: 3,
      durationMinutes: 90,                 // 1.5 hours
      selectedExtraIds: ['bar-id'],
      extraQuantities: { 'bar-id': 1 },
    })

    // base 14300 + (3 × €10 × 1.5h = €45 = 4500) + city tax (3 × 260 = 780) = 19580
    expect(result.basePriceCents).toBe(14300)
    expect(result.extrasCalculation.extras_amount_cents).toBe(4500)
    expect(result.cityTaxCents).toBe(780)
    expect(result.totalCents).toBe(14300 + 4500 + 780)
  })

  it('drops inactive extras silently (with warning) and does not include them', async () => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        { pk: 22222, customer_prototype: { total_including_tax: 10000 } },
      ],
    })

    // selectedExtraIds requests two but DB only returns one (other is inactive)
    supabaseFrom.mockReturnValue({
      select: () => ({
        in: () => ({
          eq: () => Promise.resolve({
            data: [{
              id: 'active-id',
              name: 'Coffee',
              category: 'drinks',
              price_type: 'fixed_cents',
              price_value: 500,
              vat_rate: 21,
              is_required: false,
            }],
          }),
        }),
      }),
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await calculateQuote({
      ...baseInput,
      selectedExtraIds: ['active-id', 'inactive-id'],
    })

    // Only the active extra contributes
    expect(result.extrasCalculation.extras_amount_cents).toBe(500)
    expect(warn).toHaveBeenCalledWith(
      '[calculate-quote] dropped inactive/missing extras',
      expect.objectContaining({ requested: 2, found: 1 }),
    )
    warn.mockRestore()
  })
})

// ── Promo discount ─────────────────────────────────────────────────────────

describe('calculateQuote — promo discount', () => {
  beforeEach(() => {
    getAvailabilityDetail.mockResolvedValue({
      customer_type_rates: [
        { pk: 22222, customer_prototype: { total_including_tax: 10000 } },
      ],
    })
  })

  it('caps the discount at the pre-discount total', async () => {
    const result = await calculateQuote({
      ...baseInput,
      discountAmountCents: 999_999,        // absurdly large
    })

    // total before discount = 10000 + 520 = 10520. Discount can't exceed that.
    expect(result.discountAmountCents).toBe(10520)
    // Floor at €0.50
    expect(result.totalCents).toBe(50)
  })

  it('applies a normal discount cleanly', async () => {
    const result = await calculateQuote({
      ...baseInput,
      discountAmountCents: 2000,
    })

    // 10000 + 520 - 2000 = 8520
    expect(result.discountAmountCents).toBe(2000)
    expect(result.totalCents).toBe(8520)
  })
})
