import { describe, it, expect } from 'vitest'
import { cruiseListingsSource } from './cruise-listings'
import { fakeSupabase } from './test-helpers'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asSupabase = (s: unknown) => s as any

describe('cruiseListingsSource', () => {
  const rows = [
    { id: 'l1', title: 'Private Hidden Gems Cruise', slug: 'hidden-gems-private', tagline: 'Off the beaten path', category: 'Private', created_at: '2026-01-01' },
  ]

  it('finds a listing by title and links to its editor', async () => {
    const results = await cruiseListingsSource.search(asSupabase(fakeSupabase({ cruise_listings: rows })), 'hidden gems')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Private Hidden Gems Cruise')
    expect(results[0].href).toBe('/admin/cruises/l1')
  })
  it('subtitle shows the category', async () => {
    const results = await cruiseListingsSource.search(asSupabase(fakeSupabase({ cruise_listings: rows })), 'hidden gems')
    expect(results[0].subtitle).toBe('Private')
  })
  it('finds a listing by slug', async () => {
    const results = await cruiseListingsSource.search(asSupabase(fakeSupabase({ cruise_listings: rows })), 'hidden-gems-private')
    expect(results).toHaveLength(1)
  })
  it('falls back to "—" for a missing title', async () => {
    const noTitle = [{ id: 'l2', slug: 'x', created_at: '2026-01-01' }]
    const results = await cruiseListingsSource.search(asSupabase(fakeSupabase({ cruise_listings: noTitle })), 'x')
    expect(results[0].title).toBe('—')
  })
  it('has no scope prefix — reachable only via an unscoped query', () => {
    expect(cruiseListingsSource.scope).toBeUndefined()
  })
})
