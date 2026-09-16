import { describe, it, expect, vi } from 'vitest'
import { pickRateCampaign, resolveCampaignCommission } from './campaign-commission'

function fakeSupabase(campaignRow: Record<string, unknown> | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: campaignRow, error: null })),
        })),
      })),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('resolveCampaignCommission', () => {
  it('resolves partnerId fresh from the campaign row, not a caller-supplied value', async () => {
    const supabase = fakeSupabase({
      id: 'camp-1',
      partner_id: 'partner-fresh',
      percentage_value: 10,
      investment_type: 'percentage',
    })
    const result = await resolveCampaignCommission(supabase, 'camp-1', 10000)
    expect(result).toEqual({
      campaignId: 'camp-1',
      partnerId: 'partner-fresh',
      commissionAmountCents: 1000,
    })
  })

  it('returns null when the campaign no longer exists', async () => {
    const supabase = fakeSupabase(null)
    const result = await resolveCampaignCommission(supabase, 'deleted-campaign', 10000)
    expect(result).toBeNull()
  })

  it('returns a null partnerId when the campaign has no partner', async () => {
    const supabase = fakeSupabase({
      id: 'camp-2',
      partner_id: null,
      percentage_value: 5,
      investment_type: 'percentage',
    })
    const result = await resolveCampaignCommission(supabase, 'camp-2', 10000)
    expect(result?.partnerId).toBeNull()
  })

  it('returns a null commission when the campaign has no valid commission config', async () => {
    const supabase = fakeSupabase({
      id: 'camp-3',
      partner_id: 'partner-1',
      percentage_value: null,
      investment_type: 'percentage',
    })
    const result = await resolveCampaignCommission(supabase, 'camp-3', 10000)
    expect(result?.commissionAmountCents).toBeNull()
  })

  it('computes a fixed_amount commission correctly', async () => {
    const supabase = fakeSupabase({
      id: 'camp-4',
      partner_id: 'partner-1',
      percentage_value: 2500, // fixed cents, stored in the reused column
      investment_type: 'fixed_amount',
    })
    const result = await resolveCampaignCommission(supabase, 'camp-4', 10000)
    expect(result?.commissionAmountCents).toBe(2500)
  })
})

// Things To Do In Amsterdam's real setup: 25% shared, 20% private (Diana + Curaçao links)
const SHARED = { listing_id: 'l-shared', category: 'shared', percentage_value: 25, investment_type: 'percentage' }
const DIANA = { listing_id: 'l-diana', category: 'private', percentage_value: 20, investment_type: 'percentage' }
const CURACAO = { listing_id: 'l-curacao', category: 'private', percentage_value: 20, investment_type: 'percentage' }
const SIBLINGS = [SHARED, DIANA, CURACAO]

describe('pickRateCampaign', () => {
  it('keeps the clicked campaign when the booked listing matches it', () => {
    expect(pickRateCampaign(SHARED, { id: 'l-shared', category: 'shared' }, SIBLINGS)).toBe(SHARED)
  })

  it('switches to the private rate when a shared link books a private cruise', () => {
    expect(pickRateCampaign(SHARED, { id: 'l-diana', category: 'private' }, SIBLINGS)).toBe(DIANA)
  })

  it('switches to the shared rate when a private link books the shared cruise', () => {
    expect(pickRateCampaign(DIANA, { id: 'l-shared', category: 'shared' }, SIBLINGS)).toBe(SHARED)
  })

  it('keeps the clicked campaign for a different listing in the same category', () => {
    expect(pickRateCampaign(CURACAO, { id: 'l-diana', category: 'private' }, SIBLINGS)).toBe(CURACAO)
  })

  it('falls back to a same-category sibling when no campaign exists for the exact listing', () => {
    expect(pickRateCampaign(DIANA, { id: 'l-other-shared', category: 'shared' }, SIBLINGS)).toBe(SHARED)
  })

  it('keeps the clicked campaign when the partner has no campaign for the booked category', () => {
    expect(pickRateCampaign(DIANA, { id: 'l-shared', category: 'shared' }, [DIANA, CURACAO])).toBe(DIANA)
  })

  it('keeps the clicked campaign when it is not tied to a listing (e.g. a homepage link)', () => {
    const homepage = { ...SHARED, listing_id: null, category: null, percentage_value: 10 }
    expect(pickRateCampaign(homepage, { id: 'l-diana', category: 'private' }, SIBLINGS)).toBe(homepage)
  })
})

describe('resolveCampaignCommission with a booked listing', () => {
  function tableSupabase() {
    const campaigns = [
      { id: 'c-shared', partner_id: 'p-ttd', ...SHARED, cruise_listings: { category: 'shared' } },
      { id: 'c-diana', partner_id: 'p-ttd', ...DIANA, cruise_listings: { category: 'private' } },
    ]
    const listings = [{ id: 'l-shared', category: 'shared' }, { id: 'l-diana', category: 'private' }]
    return {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: string) => {
            const rows = table === 'campaigns'
              ? campaigns.filter(c => (c as Record<string, unknown>)[col] === val)
              : listings.filter(l => (l as Record<string, unknown>)[col] === val)
            return Object.assign(Promise.resolve({ data: rows, error: null }), {
              maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
            })
          }),
        })),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  it('charges the private rate for a private booking via the shared link, keeping attribution on the link', async () => {
    const result = await resolveCampaignCommission(tableSupabase(), 'c-shared', 40000, 'l-diana')
    expect(result).toEqual({ campaignId: 'c-shared', partnerId: 'p-ttd', commissionAmountCents: 8000 })
  })

  it('charges the shared rate for a shared booking via the private link', async () => {
    const result = await resolveCampaignCommission(tableSupabase(), 'c-diana', 7000, 'l-shared')
    expect(result?.commissionAmountCents).toBe(1750)
  })

  it('uses the clicked campaign rate when no booked listing is passed', async () => {
    const result = await resolveCampaignCommission(tableSupabase(), 'c-shared', 40000)
    expect(result?.commissionAmountCents).toBe(10000)
  })
})
