import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AdsCallResult } from './campaign-client'

// Mock the transport so we can feed canned Google responses and assert the
// mapping/derivation logic — no network, no spend. Pure helpers (microsToEuros)
// stay real via importOriginal.
vi.mock('./campaign-client', async importOriginal => {
  const actual = await importOriginal<typeof import('./campaign-client')>()
  return {
    ...actual,
    googleAdsCall: vi.fn(),
    getCampaignConfig: vi.fn(() => ({
      customerId: '1234567890',
      developerToken: 'dev',
      loginCustomerId: '999',
    })),
  }
})

import { googleAdsCall } from './campaign-client'
import {
  listCampaigns,
  campaignPerformance,
  listKeywords,
  searchTerms,
  listAccessibleCustomers,
} from './reporting'

const mockCall = vi.mocked(googleAdsCall)
const ok = (data: unknown): AdsCallResult<unknown> => ({ ok: true, status: 200, data })
const boom = (error: string): AdsCallResult<unknown> => ({ ok: false, status: 400, error })

/** Read the GAQL query string sent on the Nth call. */
function sentQuery(call = 0): string {
  const body = mockCall.mock.calls[call]?.[1]?.body as { query?: string } | undefined
  return body?.query ?? ''
}
function sentPath(call = 0): string {
  return mockCall.mock.calls[call]?.[0] ?? ''
}

beforeEach(() => mockCall.mockReset())

describe('listAccessibleCustomers', () => {
  it('strips the customers/ prefix off each resource name', async () => {
    mockCall.mockResolvedValue(ok({ resourceNames: ['customers/111', 'customers/222'] }))
    const res = await listAccessibleCustomers()
    expect(res.ok).toBe(true)
    expect(res.rows).toEqual(['111', '222'])
    expect(sentPath()).toBe('customers:listAccessibleCustomers')
  })
  it('propagates an API error', async () => {
    mockCall.mockResolvedValue(boom('no access'))
    const res = await listAccessibleCustomers()
    expect(res).toEqual({ ok: false, error: 'no access' })
  })
})

describe('listCampaigns', () => {
  it('maps fields and converts the budget micros → euros', async () => {
    mockCall.mockResolvedValue(
      ok({
        results: [
          {
            campaign: { id: 111, name: 'Private Cruise', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
            campaignBudget: { amountMicros: '30000000' },
          },
        ],
      }),
    )
    const res = await listCampaigns()
    expect(res.rows).toEqual([
      { id: '111', name: 'Private Cruise', status: 'ENABLED', channelType: 'SEARCH', dailyBudgetEuros: 30 },
    ])
    expect(sentQuery()).toContain('FROM campaign')
  })
  it('survives missing budget (defaults to €0)', async () => {
    mockCall.mockResolvedValue(ok({ results: [{ campaign: { id: 9, name: 'x', status: 'PAUSED' } }] }))
    const res = await listCampaigns()
    expect(res.rows?.[0].dailyBudgetEuros).toBe(0)
  })
})

describe('campaignPerformance', () => {
  it('derives ctr%, cost/conv and ROAS from raw metrics', async () => {
    mockCall.mockResolvedValue(
      ok({
        results: [
          {
            campaign: { id: 1, name: 'A' },
            metrics: {
              impressions: '1000',
              clicks: '50',
              ctr: 0.05,
              costMicros: '20000000', // €20
              conversions: 4,
              conversionsValue: 600,
              averageCpc: '400000', // €0.40
            },
          },
        ],
      }),
    )
    const r = (await campaignPerformance(30)).rows?.[0]
    expect(r).toMatchObject({
      impressions: 1000,
      clicks: 50,
      ctr: 5, // 0.05 * 100
      costEuros: 20,
      conversions: 4,
      conversionValueEuros: 600,
      avgCpcEuros: 0.4,
      costPerConversionEuros: 5, // 20 / 4
      roas: 30, // 600 / 20
    })
  })

  it('returns null cost/conv and ROAS when there are no conversions / no cost', async () => {
    mockCall.mockResolvedValue(
      ok({
        results: [
          { campaign: { id: 2, name: 'B' }, metrics: { impressions: '10', clicks: '1', costMicros: '0', conversions: 0, conversionsValue: 0 } },
        ],
      }),
    )
    const r = (await campaignPerformance(7)).rows?.[0]
    expect(r?.costPerConversionEuros).toBeNull()
    expect(r?.roas).toBeNull()
  })

  it('embeds a BETWEEN date range for the requested window', async () => {
    mockCall.mockResolvedValue(ok({ results: [] }))
    await campaignPerformance(7)
    expect(sentQuery()).toMatch(/segments\.date BETWEEN '\d{4}-\d{2}-\d{2}' AND '\d{4}-\d{2}-\d{2}'/)
  })
})

describe('listKeywords', () => {
  it('maps keyword_view rows', async () => {
    mockCall.mockResolvedValue(
      ok({
        results: [
          {
            adGroupCriterion: { keyword: { text: 'private boat amsterdam', matchType: 'PHRASE' }, status: 'ENABLED' },
            adGroup: { name: 'Private Boat' },
            metrics: { impressions: '120', clicks: '8', conversions: 2, costMicros: '7500000' },
          },
        ],
      }),
    )
    const r = (await listKeywords()).rows?.[0]
    expect(r).toEqual({
      text: 'private boat amsterdam',
      matchType: 'PHRASE',
      status: 'ENABLED',
      adGroup: 'Private Boat',
      impressions: 120,
      clicks: 8,
      conversions: 2,
      costEuros: 7.5,
    })
  })
  it('adds a campaign filter to the query when given a campaignId', async () => {
    mockCall.mockResolvedValue(ok({ results: [] }))
    await listKeywords('555', 14)
    expect(sentQuery()).toContain('campaign.id = 555')
    expect(sentQuery()).toContain('FROM keyword_view')
  })
})

describe('searchTerms', () => {
  it('maps search_term_view rows', async () => {
    mockCall.mockResolvedValue(
      ok({
        results: [{ searchTermView: { searchTerm: 'rent private boat amsterdam' }, metrics: { impressions: '30', clicks: '3', conversions: 1, costMicros: '2000000' } }],
      }),
    )
    const r = (await searchTerms()).rows?.[0]
    expect(r).toEqual({ term: 'rent private boat amsterdam', impressions: 30, clicks: 3, conversions: 1, costEuros: 2 })
    expect(sentQuery()).toContain('FROM search_term_view')
  })
})
