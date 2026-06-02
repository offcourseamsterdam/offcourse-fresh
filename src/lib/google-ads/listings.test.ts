import { describe, it, expect } from 'vitest'
import { listingUrl, getCampaignMarketingMap, listMarketingCampaigns } from './listings'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

describe('listingUrl', () => {
  it('builds /cruises/<slug> from the base URL', () => {
    expect(listingUrl('off-beaten-path-hidden-gems-canal-cruise', 'https://offcourseamsterdam.com')).toBe(
      'https://offcourseamsterdam.com/cruises/off-beaten-path-hidden-gems-canal-cruise',
    )
  })
  it('strips a trailing slash from the base URL', () => {
    expect(listingUrl('private', 'https://offcourseamsterdam.com/')).toBe(
      'https://offcourseamsterdam.com/cruises/private',
    )
  })
  it('defaults the base URL when none is given', () => {
    expect(listingUrl('private')).toMatch(/\/cruises\/private$/)
  })
})

// Minimal stand-in for the Supabase client. getCampaignMarketingMap awaits
// `.from().select()`; listMarketingCampaigns awaits `.from().select().eq().order()`.
// Embedded to-one relations come back as either an object OR a 1-element array —
// these tests prove we normalize both.
function mockDb(rows: unknown[]): SupabaseClient<Database> {
  const result = Promise.resolve({ data: rows, error: null })
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => result,
    then: (...a: Parameters<typeof result.then>) => result.then(...a),
  }
  return { from: () => chain } as unknown as SupabaseClient<Database>
}

describe('getCampaignMarketingMap', () => {
  it('maps gAds campaign → marketing campaign with a derived listing (object embed)', async () => {
    const db = mockDb([
      {
        campaign_id: '23903583517',
        marketing_campaign_id: 'm-1',
        listing_id: 'l-1',
        listing_slug: 'off-beaten-path',
        campaigns: { name: 'first private cruise campaign', slug: 'first-private-cruise-campaign' },
        cruise_listings: { title: 'Private Hidden Gems Cruise' },
      },
    ])
    const map = await getCampaignMarketingMap(db)
    expect(map['23903583517']).toEqual({
      id: 'm-1',
      name: 'first private cruise campaign',
      slug: 'first-private-cruise-campaign',
      listing: { id: 'l-1', slug: 'off-beaten-path', title: 'Private Hidden Gems Cruise' },
    })
  })

  it('normalizes array-shaped embeds and a missing listing', async () => {
    const db = mockDb([
      {
        campaign_id: 'g-2',
        marketing_campaign_id: 'm-2',
        listing_id: null,
        listing_slug: null,
        campaigns: [{ name: 'biolink', slug: 'biolink' }], // array embed
        cruise_listings: null,
      },
    ])
    const map = await getCampaignMarketingMap(db)
    expect(map['g-2'].name).toBe('biolink')
    expect(map['g-2'].listing).toBeNull()
  })

  it('skips rows with no marketing campaign linked', async () => {
    const db = mockDb([
      { campaign_id: 'g-3', marketing_campaign_id: null, listing_id: null, listing_slug: null, campaigns: null, cruise_listings: null },
    ])
    expect(await getCampaignMarketingMap(db)).toEqual({})
  })
})

describe('listMarketingCampaigns', () => {
  it('returns campaigns with their derived listing for the dropdown', async () => {
    const db = mockDb([
      { id: 'm-1', name: 'first private cruise campaign', slug: 'first-private-cruise-campaign', listing_id: 'l-1', cruise_listings: { slug: 'off-beaten-path', title: 'Private Hidden Gems Cruise' } },
      { id: 'm-2', name: 'biolink', slug: 'biolink', listing_id: null, cruise_listings: null },
    ])
    const list = await listMarketingCampaigns(db)
    expect(list).toHaveLength(2)
    expect(list[0].listing?.title).toBe('Private Hidden Gems Cruise')
    expect(list[1].listing).toBeNull()
  })
})
