import { describe, it, expect } from 'vitest'
import {
  campaignProfit,
  verdict,
  sumPerformance,
  heroStats,
  funnelSteps,
  mergeCampaign,
} from './dashboard'
import type { PerformanceRow, CampaignRow } from './reporting'

const perf = (over: Partial<PerformanceRow> = {}): PerformanceRow => ({
  id: '1',
  name: 'C',
  impressions: 1000,
  clicks: 50,
  ctr: 5,
  costEuros: 20,
  conversions: 4,
  conversionValueEuros: 600,
  avgCpcEuros: 0.4,
  costPerConversionEuros: 5,
  roas: 30,
  ...over,
})

describe('campaignProfit', () => {
  it('profit = net revenue − ad spend', () => {
    expect(campaignProfit({ costEuros: 20, conversionValueEuros: 600, conversions: 4 })).toEqual({
      profitEuros: 580,
      costPerBookingEuros: 5,
      profitPerBookingEuros: 145,
    })
  })
  it('null per-booking figures when there are no bookings', () => {
    const r = campaignProfit({ costEuros: 20, conversionValueEuros: 0, conversions: 0 })
    expect(r.profitEuros).toBe(-20)
    expect(r.costPerBookingEuros).toBeNull()
    expect(r.profitPerBookingEuros).toBeNull()
  })
})

describe('verdict', () => {
  it('PAUSED → paused (regardless of numbers)', () => {
    expect(verdict({ status: 'PAUSED', costEuros: 100, conversions: 5, profitEuros: 50 }).key).toBe('paused')
  })
  it('no spend → idle', () => {
    expect(verdict({ status: 'ENABLED', costEuros: 0, conversions: 0, profitEuros: 0 }).key).toBe('idle')
  })
  it('spend below floor, no bookings → warming (not alarming yet)', () => {
    const v = verdict({ status: 'ENABLED', costEuros: 10, conversions: 0, profitEuros: -10 })
    expect(v.key).toBe('warming')
    expect(v.tone).toBe('learn')
  })
  it('spend above floor, no bookings → burning (bad)', () => {
    const v = verdict({ status: 'ENABLED', costEuros: 40, conversions: 0, profitEuros: -40 })
    expect(v.key).toBe('burning')
    expect(v.tone).toBe('bad')
  })
  it('bookings + positive profit → profitable (good)', () => {
    const v = verdict({ status: 'ENABLED', costEuros: 20, conversions: 4, profitEuros: 580 })
    expect(v.key).toBe('profitable')
    expect(v.tone).toBe('good')
  })
  it('bookings but profit ≤ 0 → losing (bad)', () => {
    const v = verdict({ status: 'ENABLED', costEuros: 200, conversions: 1, profitEuros: -50 })
    expect(v.key).toBe('losing')
    expect(v.tone).toBe('bad')
  })
  it('respects a custom burn floor', () => {
    expect(verdict({ status: 'ENABLED', costEuros: 40, conversions: 0, profitEuros: -40 }, { burnFloorEuros: 100 }).key).toBe('warming')
  })
})

describe('sumPerformance + heroStats', () => {
  const rows = [perf({ costEuros: 20, conversionValueEuros: 600, conversions: 4, impressions: 1000, clicks: 50 }), perf({ id: '2', costEuros: 80, conversionValueEuros: 400, conversions: 2, impressions: 3000, clicks: 90 })]
  it('sums the raw metrics', () => {
    expect(sumPerformance(rows)).toEqual({ impressions: 4000, clicks: 140, costEuros: 100, bookings: 6, revenueEuros: 1000 })
  })
  it('hero: profit = revenue − spend, roas = revenue ÷ spend', () => {
    const h = heroStats(rows)
    expect(h.profitEuros).toBe(900) // 1000 − 100
    expect(h.bookings).toBe(6)
    expect(h.roas).toBe(10) // 1000 / 100
    expect(h.spendEuros).toBe(100)
  })
  it('roas is null when nothing was spent', () => {
    expect(heroStats([perf({ costEuros: 0, conversionValueEuros: 0, conversions: 0 })]).roas).toBeNull()
  })
})

describe('funnelSteps', () => {
  it('builds 3 steps with drop-off fractions from the previous step', () => {
    const steps = funnelSteps({ impressions: 1000, clicks: 50, bookings: 5 })
    expect(steps.map(s => s.event)).toEqual(['impressions', 'clicks', 'bookings'])
    expect(steps[0].drop_off_rate).toBe(0)
    expect(steps[1].drop_off_rate).toBeCloseTo(0.95) // (1000−50)/1000
    expect(steps[2].drop_off_rate).toBeCloseTo(0.9) // (50−5)/50
    expect(steps[2].count).toBe(5)
  })
  it('handles an all-zero funnel without dividing by zero', () => {
    const steps = funnelSteps({ impressions: 0, clicks: 0, bookings: 0 })
    expect(steps.every(s => s.drop_off_rate === 0 && s.count === 0)).toBe(true)
  })
  it('rounds fractional bookings for display', () => {
    expect(funnelSteps({ impressions: 100, clicks: 10, bookings: 2.6 })[2].count).toBe(3)
  })
})

describe('mergeCampaign', () => {
  const campaign: CampaignRow = { id: '1', name: 'Private Cruise', status: 'ENABLED', channelType: 'SEARCH', dailyBudgetEuros: 30 }
  const link = {
    id: 'camp-1',
    name: 'first private cruise campaign',
    slug: 'first-private-cruise-campaign',
    listing: { id: 'uuid-1', slug: 'private-cruise', title: 'Private Hidden Gems Cruise' },
  }

  it('merges settings + performance + marketing link, derives listing/profit/verdict', () => {
    const row = mergeCampaign(campaign, perf({ costEuros: 20, conversionValueEuros: 600, conversions: 4, avgCpcEuros: 0.4 }), link)
    expect(row.profitEuros).toBe(580)
    expect(row.avgCpcEuros).toBe(0.4)
    expect(row.verdict.key).toBe('profitable')
    expect(row.marketing?.name).toBe('first private cruise campaign')
    expect(row.listing?.title).toBe('Private Hidden Gems Cruise') // derived from the campaign
    expect(row.dailyBudgetEuros).toBe(30)
  })

  it('derives a null listing when the linked campaign has none', () => {
    const row = mergeCampaign(campaign, undefined, { id: 'camp-2', name: 'biolink', slug: 'biolink', listing: null })
    expect(row.marketing?.name).toBe('biolink')
    expect(row.listing).toBeNull()
  })

  it('handles a campaign with no link/performance yet (zeros, idle verdict)', () => {
    const row = mergeCampaign(campaign, undefined, null)
    expect(row.costEuros).toBe(0)
    expect(row.bookings).toBe(0)
    expect(row.avgCpcEuros).toBe(0)
    expect(row.profitEuros).toBe(0)
    expect(row.verdict.key).toBe('idle')
    expect(row.marketing).toBeNull()
    expect(row.listing).toBeNull()
  })
})
