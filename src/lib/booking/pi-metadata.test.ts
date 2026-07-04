import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  quoteLookup: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: h.quoteLookup }),
      }),
    }),
  }),
}))

import { parseMetaCents, getExtrasFromQuote } from './pi-metadata'

describe('parseMetaCents', () => {
  it('parses normal amounts', () => {
    expect(parseMetaCents('16500')).toBe(16500)
  })

  it('respects an explicit zero (the || fallback bug)', () => {
    expect(parseMetaCents('0')).toBe(0)
  })

  it('returns null for missing or invalid values so callers can fall back', () => {
    expect(parseMetaCents(undefined)).toBeNull()
    expect(parseMetaCents('')).toBeNull()
    expect(parseMetaCents('not-a-number')).toBeNull()
  })
})

describe('getExtrasFromQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns [] when no quoteId is given', async () => {
    expect(await getExtrasFromQuote(undefined)).toEqual([])
    expect(h.quoteLookup).not.toHaveBeenCalled()
  })

  it('returns [] when the quote has no breakdown', async () => {
    h.quoteLookup.mockResolvedValue({ data: null })
    expect(await getExtrasFromQuote('q1')).toEqual([])
  })

  it('maps line items and drops zero/blank ones', async () => {
    h.quoteLookup.mockResolvedValue({
      data: {
        breakdown: {
          extrasCalculation: {
            line_items: [
              { name: 'Cheese board', amount_cents: 1500, extra_id: 'e1', quantity: 1, vat_rate: 21, vat_amount_cents: 260 },
              { name: 'Free thing', amount_cents: 0 },
              { name: '', amount_cents: 500 },
            ],
          },
        },
      },
    })

    const result = await getExtrasFromQuote('q1')

    expect(result).toEqual([
      { name: 'Cheese board', amount_cents: 1500, extra_id: 'e1', quantity: 1, vat_rate: 21, vat_amount_cents: 260 },
    ])
  })

  it('swallows lookup errors and returns []', async () => {
    h.quoteLookup.mockRejectedValue(new Error('db down'))
    expect(await getExtrasFromQuote('q1')).toEqual([])
  })
})
