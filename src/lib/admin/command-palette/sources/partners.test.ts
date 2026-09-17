import { describe, it, expect } from 'vitest'
import { partnersSource, promoCodesSource } from './partners'
import { fakeSupabase } from './test-helpers'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asSupabase = (s: unknown) => s as any

describe('partnersSource', () => {
  const rows = [
    { id: 'p1', name: 'Acme Charters', email: 'hello@acme.test', contact_name: 'Jo Acme', phone: '+31600000000', created_at: '2026-01-01' },
  ]

  it('finds a partner by name and links to its detail page', async () => {
    const results = await partnersSource.search(asSupabase(fakeSupabase({ partners: rows })), 'acme')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Acme Charters')
    expect(results[0].href).toBe('/admin/partners/p1')
  })
  it('subtitle joins contact name and email', async () => {
    const results = await partnersSource.search(asSupabase(fakeSupabase({ partners: rows })), 'acme')
    expect(results[0].subtitle).toBe('Jo Acme · hello@acme.test')
  })
  it('finds a partner by contact email', async () => {
    const results = await partnersSource.search(asSupabase(fakeSupabase({ partners: rows })), 'hello@acme.test')
    expect(results).toHaveLength(1)
  })
  it('falls back to "—" for a missing name', async () => {
    const noName = [{ id: 'p2', email: 'x@y.test', created_at: '2026-01-01' }]
    const results = await partnersSource.search(asSupabase(fakeSupabase({ partners: noName })), 'x@y.test')
    expect(results[0].title).toBe('—')
  })
  it('is scoped to the "partners" prefix, group "Partners & promo"', () => {
    expect(partnersSource.scope).toBe('partners')
    expect(partnersSource.group).toBe('Partners & promo')
  })
})

describe('promoCodesSource', () => {
  const rows = [{ id: 'c1', code: 'SUMMER26', label: 'Summer 2026 promo', notes: null, created_at: '2026-01-01' }]

  it('finds a promo code and links to the promo codes page', async () => {
    const results = await promoCodesSource.search(asSupabase(fakeSupabase({ promo_codes: rows })), 'SUMMER26')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('SUMMER26')
    expect(results[0].subtitle).toBe('Summer 2026 promo')
    expect(results[0].href).toBe('/admin/promo-codes')
  })
  it('finds a promo code by its label', async () => {
    const results = await promoCodesSource.search(asSupabase(fakeSupabase({ promo_codes: rows })), 'summer 2026')
    expect(results).toHaveLength(1)
  })
})
