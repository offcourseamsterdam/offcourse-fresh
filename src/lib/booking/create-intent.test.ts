import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests the quote-claim invariants in createPaymentIntent:
 *   1. The claim is a single conditional UPDATE (consumed_at IS NULL) — a
 *      request that loses the race gets "already been used", never a second
 *      charge.
 *   2. A failure AFTER the claim (Stripe outage, price drift) releases the
 *      claim so the customer can retry.
 *   3. The happy path records the PaymentIntent id on the quote.
 */

const h = vi.hoisted(() => ({
  // Each from('pricing_quotes') call consumes the next queued result.
  results: [] as Array<{ data: unknown; error: unknown }>,
  updateArgs: [] as Array<Record<string, unknown>>,
  piCreate: vi.fn(),
  calculateQuote: vi.fn(),
  fhValidate: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const result = h.results.shift() ?? { data: null, error: null }
      const chain: Record<string, unknown> = {}
      chain.update = (args: Record<string, unknown>) => {
        h.updateArgs.push(args)
        return chain
      }
      chain.select = () => chain
      chain.eq = () => chain
      chain.is = () => chain
      chain.maybeSingle = () => Promise.resolve(result)
      // The release/consumed_intent_id updates are awaited directly (thenable)
      chain.then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled)
      return chain
    },
  }),
}))
vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ paymentIntents: { create: h.piCreate } }),
}))
vi.mock('@/lib/booking/calculate-quote', () => ({ calculateQuote: h.calculateQuote }))
vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({ validateBooking: h.fhValidate }),
}))

import { createPaymentIntent } from './create-intent'

const FUTURE = new Date(Date.now() + 10 * 60 * 1000).toISOString()

function makeQuoteRow(overrides: object = {}) {
  return {
    id: 'quote-1',
    expires_at: FUTURE,
    consumed_at: null,
    listing_id: 'listing-1',
    avail_pk: 1001,
    customer_type_rate_pk: 2002,
    guest_count: 2,
    category: 'private',
    duration_minutes: 90,
    selected_extra_ids: [],
    extra_quantities: {},
    promo_code_id: null,
    discount_amount_cents: 0,
    total_cents: 16500,
    ...overrides,
  }
}

function makeRecomputed() {
  return {
    totalCents: 16500,
    serverBaseAmount: 15000,
    cityTaxCents: 520,
    discountAmountCents: 0,
    customerTypeName: 'Diana 1.5h',
    extrasCalculation: {
      line_items: [],
      extras_amount_cents: 0,
      base_vat_amount_cents: 1238,
      extras_vat_amount_cents: 0,
      total_vat_amount_cents: 1238,
    },
  }
}

const INPUT = {
  quoteId: 'quote-1',
  listingTitle: 'Canal Cruise',
  date: '2026-06-20',
  contact: { name: 'Finn Test', email: 'finn@example.com' },
}

describe('createPaymentIntent — atomic quote claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.results.length = 0
    h.updateArgs.length = 0
    h.calculateQuote.mockResolvedValue(makeRecomputed())
    h.piCreate.mockResolvedValue({ id: 'pi_new', client_secret: 'pi_new_secret', amount: 16500 })
    // Validate-before-charge: default to bookable so the happy paths proceed.
    h.fhValidate.mockResolvedValue({ is_bookable: true })
  })

  it('validates with FareHarbor BEFORE charging — never creates a PI for a gone slot', async () => {
    h.results.push(
      { data: makeQuoteRow(), error: null },   // claim succeeds
      { data: null, error: null },             // release update
    )
    h.fhValidate.mockResolvedValue({ is_bookable: false, error: 'Sold out' })

    await expect(createPaymentIntent(INPUT)).rejects.toThrow(/Sold out|no longer available/)
    expect(h.piCreate).not.toHaveBeenCalled()
    // The claim is released so the customer can re-quote and retry
    expect(h.updateArgs[1]).toMatchObject({ consumed_at: null })
  })

  it('rejects the loser of a double-tap race with "already been used"', async () => {
    h.results.push(
      { data: null, error: null },                                      // claim: no row won
      { data: { id: 'quote-1', consumed_at: FUTURE }, error: null },    // lookup: already consumed
    )

    await expect(createPaymentIntent(INPUT)).rejects.toThrow(/already been used/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('rejects an unknown quote with "could not be found"', async () => {
    h.results.push(
      { data: null, error: null },   // claim fails
      { data: null, error: null },   // lookup: no such quote
    )

    await expect(createPaymentIntent(INPUT)).rejects.toThrow(/could not be found/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('rejects an expired quote after claiming it', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString()
    h.results.push({ data: makeQuoteRow({ expires_at: past }), error: null })

    await expect(createPaymentIntent(INPUT)).rejects.toThrow(/expired/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('releases the claim when Stripe fails, so the customer can retry', async () => {
    h.results.push(
      { data: makeQuoteRow(), error: null },   // claim succeeds
      { data: null, error: null },             // release update
    )
    h.piCreate.mockRejectedValue(new Error('stripe is down'))

    await expect(createPaymentIntent(INPUT)).rejects.toThrow('stripe is down')

    // First update = the claim; second = the release back to unclaimed
    expect(h.updateArgs[0]).toMatchObject({ consumed_at: expect.any(String) })
    expect(h.updateArgs[1]).toMatchObject({ consumed_at: null })
  })

  it('charges the recomputed total and records the consuming PI on success', async () => {
    h.results.push(
      { data: makeQuoteRow(), error: null },   // claim succeeds
      { data: null, error: null },             // consumed_intent_id update
    )

    const result = await createPaymentIntent(INPUT)

    expect(result.clientSecret).toBe('pi_new_secret')
    expect(result.chargedCents).toBe(16500)
    expect(h.piCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 16500, currency: 'eur' }),
    )
    expect(h.updateArgs[0]).toMatchObject({ consumed_at: expect.any(String) })
    expect(h.updateArgs[1]).toMatchObject({ consumed_intent_id: 'pi_new' })
  })

  it('carries campaignId/partnerId into PI metadata when the visitor came via a tracking link', async () => {
    h.results.push(
      { data: makeQuoteRow(), error: null },   // claim succeeds
      { data: null, error: null },             // consumed_intent_id update
    )

    await createPaymentIntent({ ...INPUT, campaignId: 'camp-1', partnerId: 'partner-1' })

    expect(h.piCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ campaign_id: 'camp-1', partner_id: 'partner-1' }),
      }),
    )
  })

  it('omits campaign_id/partner_id from PI metadata for organic bookings (no attribution)', async () => {
    h.results.push(
      { data: makeQuoteRow(), error: null },
      { data: null, error: null },
    )

    await createPaymentIntent(INPUT)

    const metadata = h.piCreate.mock.calls[0][0].metadata
    expect(metadata).not.toHaveProperty('campaign_id')
    expect(metadata).not.toHaveProperty('partner_id')
  })

  it('refuses when the recomputed total drifts from the stored quote', async () => {
    h.results.push(
      { data: makeQuoteRow({ total_cents: 14000 }), error: null },   // stored ≠ recomputed
      { data: null, error: null },                                   // release update
    )

    await expect(createPaymentIntent(INPUT)).rejects.toThrow(/price changed/)
    expect(h.piCreate).not.toHaveBeenCalled()
    // The claim must be released so the customer can re-quote and retry
    expect(h.updateArgs[1]).toMatchObject({ consumed_at: null })
  })
})
