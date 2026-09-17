import { describe, it, expect } from 'vitest'
import { euros, FINANCE_SOURCES } from './finance'
import { fakeSupabase } from './test-helpers'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asSupabase = (s: unknown) => s as any

describe('euros', () => {
  it('formats a positive cents amount', () => {
    expect(euros(12000)).toBe('€120')
  })
  it('omits the amount entirely (not "€0") when the field is null', () => {
    expect(euros(null)).toBeNull()
  })
  it('omits the amount when the field is missing/undefined', () => {
    expect(euros(undefined)).toBeNull()
  })
  it('puts the minus sign before the currency symbol, matching the rest of the admin', () => {
    expect(euros(-1200)).toBe('-€12')
  })
  it('shows "—" for a genuine zero amount rather than "€0" — matches fmtAdminAmountRounded elsewhere', () => {
    expect(euros(0)).toBe('—')
  })
})

describe('FINANCE_SOURCES — Viator (representative of the simpleSource-backed finance sources)', () => {
  const viator = FINANCE_SOURCES[0]
  const rows = [
    { id: '1', viator_reference: 'VR-100', vendor_reference: 'ABC', tour_grade_title: 'Canal Cruise', gross_currency: 'EUR', created_at: '2026-01-01' },
    { id: '2', viator_reference: 'VR-200', vendor_reference: 'XYZ', tour_grade_title: 'Sunset Tour', gross_currency: 'EUR', created_at: '2026-03-01' },
  ]

  it('finds a record by its reference', async () => {
    const results = await viator.search(asSupabase(fakeSupabase({ viator_payment_lines: rows })), 'VR-100')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Viator · VR-100')
    expect(results[0].href).toBe('/admin/finance?tab=viator')
  })
  it('typing the source name returns its most recent records instead of a text match', async () => {
    const results = await viator.search(asSupabase(fakeSupabase({ viator_payment_lines: rows })), 'viator')
    expect(results).toHaveLength(2)
    expect(results[0].title).toContain('VR-200') // newest created_at first
  })
})

describe('FINANCE_SOURCES — a source whose subtitle uses euros() (GetYourGuide)', () => {
  const gyg = FINANCE_SOURCES[1]

  it('omits the amount from the subtitle when amount_cents is null, instead of showing "€0"', async () => {
    const rows = [{ id: '1', payment_number: 'PN-1', invoice_number: 'INV-1', amount_cents: null, created_at: '2026-01-01' }]
    const results = await gyg.search(asSupabase(fakeSupabase({ getyourguide_payments: rows })), 'PN-1')
    expect(results[0].subtitle).toBeUndefined()
  })
  it('formats a real amount in the subtitle', async () => {
    const rows = [{ id: '1', payment_number: 'PN-1', invoice_number: 'INV-1', amount_cents: 5000, created_at: '2026-01-01' }]
    const results = await gyg.search(asSupabase(fakeSupabase({ getyourguide_payments: rows })), 'PN-1')
    expect(results[0].subtitle).toBe('€50')
  })
})

describe('FINANCE_SOURCES — every entry', () => {
  it('has exactly one source per Kasboek partner, all group "Finance" and scope "finance"', () => {
    expect(FINANCE_SOURCES).toHaveLength(10)
    for (const source of FINANCE_SOURCES) {
      expect(source.group).toBe('Finance')
      expect(source.scope).toBe('finance')
    }
  })
})
