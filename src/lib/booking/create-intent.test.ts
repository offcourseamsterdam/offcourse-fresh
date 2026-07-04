import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * create-intent.ts is the quote-trust / anti-tampering boundary: it decides
 * whether a card gets charged and for how much. Every gate here is the only thing
 * standing between a customer and a wrong/tampered charge, so each is pinned:
 *   - missing quoteId
 *   - quote not found
 *   - expired quote
 *   - already-consumed quote
 *   - recomputed total drift (server disagrees with the stored quote)
 *   - the €0.50 floor
 *   - the happy path (PI created against the recomputed total, quote consumed)
 */

const h = vi.hoisted(() => ({
  quoteRow: null as Record<string, unknown> | null,
  piCreate: vi.fn(),
  calculateQuote: vi.fn(),
  consumeEq: vi.fn().mockResolvedValue({ error: null }),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ paymentIntents: { create: h.piCreate } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.quoteRow, error: null }) }) }),
      update: () => ({ eq: h.consumeEq }),
    }),
  }),
}))
vi.mock('@/lib/booking/calculate-quote', () => ({ calculateQuote: h.calculateQuote }))

import { createPaymentIntent } from './create-intent'

function makeQuoteRow(over: Record<string, unknown> = {}) {
  return {
    id: 'quote_1',
    listing_id: 'listing_1',
    avail_pk: 111,
    customer_type_rate_pk: 222,
    guest_count: 2,
    category: 'private',
    duration_minutes: 90,
    selected_extra_ids: [],
    extra_quantities: {},
    promo_code_id: null,
    discount_amount_cents: 0,
    total_cents: 16500,
    expires_at: new Date(Date.now() + 600_000).toISOString(), // 10 min in the future
    consumed_at: null,
    ...over,
  }
}

function makeRecomputed(totalCents: number) {
  return {
    totalCents,
    serverBaseAmount: 15000,
    customerTypeName: 'Diana - 1.5 Hours',
    cityTaxCents: 520,
    discountAmountCents: 0,
    extrasCalculation: {
      line_items: [],
      extras_amount_cents: 0,
      base_vat_amount_cents: 1239,
      extras_vat_amount_cents: 0,
      total_vat_amount_cents: 1239,
    },
  }
}

const baseInput = {
  quoteId: 'quote_1',
  listingTitle: 'Hidden Gems Private Boat Tour',
  date: '2026-07-01',
  contact: { name: 'Test Guest', email: 'guest@example.com', phone: '+31600000000' },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.quoteRow = makeQuoteRow()
  h.piCreate.mockResolvedValue({ id: 'pi_123', client_secret: 'cs_123' })
  h.calculateQuote.mockResolvedValue(makeRecomputed(16500))
})

describe('createPaymentIntent — anti-tampering gates', () => {
  it('rejects a missing quoteId without touching Stripe', async () => {
    await expect(createPaymentIntent({ ...baseInput, quoteId: '' })).rejects.toThrow(/Missing quoteId/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('rejects when the quote cannot be found', async () => {
    h.quoteRow = null
    await expect(createPaymentIntent(baseInput)).rejects.toThrow(/could not be found/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('rejects an expired quote', async () => {
    h.quoteRow = makeQuoteRow({ expires_at: new Date(Date.now() - 1_000).toISOString() })
    await expect(createPaymentIntent(baseInput)).rejects.toThrow(/expired/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('rejects a quote that was already consumed', async () => {
    h.quoteRow = makeQuoteRow({ consumed_at: new Date().toISOString() })
    await expect(createPaymentIntent(baseInput)).rejects.toThrow(/already been used/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('refuses to charge when the recomputed total drifts from the stored quote', async () => {
    // The stored quote says 16500 but a fresh server compute says 17000 — something
    // changed (price, deactivated extra). NEVER charge the stale amount.
    h.quoteRow = makeQuoteRow({ total_cents: 16500 })
    h.calculateQuote.mockResolvedValue(makeRecomputed(17000))
    await expect(createPaymentIntent(baseInput)).rejects.toThrow(/price changed/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('rejects an amount below the €0.50 Stripe floor', async () => {
    h.quoteRow = makeQuoteRow({ total_cents: 40 })
    h.calculateQuote.mockResolvedValue(makeRecomputed(40))
    await expect(createPaymentIntent(baseInput)).rejects.toThrow(/at least €0.50/)
    expect(h.piCreate).not.toHaveBeenCalled()
  })

  it('creates the PaymentIntent against the recomputed total and returns its client secret', async () => {
    const result = await createPaymentIntent(baseInput)

    expect(h.piCreate).toHaveBeenCalledTimes(1)
    const args = h.piCreate.mock.calls[0][0]
    expect(args.amount).toBe(16500)
    expect(args.currency).toBe('eur')
    expect(args.payment_method_types).toEqual(['card', 'ideal', 'link'])
    expect(result.clientSecret).toBe('cs_123')
    expect(result.chargedCents).toBe(16500)
    // Quote is marked consumed so it can't be replayed.
    expect(h.consumeEq).toHaveBeenCalledTimes(1)
  })
})
