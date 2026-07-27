import { describe, it, expect, vi } from 'vitest'
import { resolveCampaignCommission } from './campaign-commission'

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
