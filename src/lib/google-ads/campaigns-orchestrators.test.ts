import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AdsCallResult } from './campaign-client'

// Exercise the orchestrators (the functions that actually call the API) with a
// mocked transport: we assert the endpoint + payload they build, and how they
// parse the response — without any network or spend.
vi.mock('./campaign-client', async importOriginal => {
  const actual = await importOriginal<typeof import('./campaign-client')>()
  return {
    ...actual, // keep real eurosToMicros / microsToEuros
    googleAdsCall: vi.fn(),
    getCampaignConfig: vi.fn(() => ({ customerId: '1234567890', developerToken: 'dev', loginCustomerId: '999' })),
    customerPath: vi.fn(() => 'customers/1234567890'),
  }
})

import { googleAdsCall } from './campaign-client'
import {
  createSearchCampaign,
  setCampaignStatus,
  updateCampaignBudget,
  addKeywords,
  addNegativeKeywords,
  type SearchCampaignSpec,
} from './campaigns'

const mockCall = vi.mocked(googleAdsCall)
const ok = (data: unknown): AdsCallResult<unknown> => ({ ok: true, status: 200, data })

interface Op {
  create?: Record<string, unknown>
  update?: Record<string, unknown>
  updateMask?: string
}
interface MutateBody {
  operations?: Op[]
  validateOnly?: boolean
}
const path = (n = 0) => mockCall.mock.calls[n]?.[0] ?? ''
const body = <T>(n = 0): T => mockCall.mock.calls[n]?.[1]?.body as T

const spec: SearchCampaignSpec = {
  campaignName: 'Off Course — Private Canal Cruise',
  dailyBudgetEuros: 30,
  adGroupName: 'Private Boat — Amsterdam',
  keywords: ['private boat amsterdam'],
  matchType: 'PHRASE',
  negativeKeywords: ['houseboat'],
  locations: ['Netherlands'],
  languages: ['English'],
  ad: {
    finalUrl: 'https://offcourseamsterdam.com/cruises/private',
    headlines: ['One headline here', 'Two headline here', 'Three headline here'],
    descriptions: ['A description long enough to be valid here.', 'Second description, also valid.'],
  },
}

beforeEach(() => mockCall.mockReset())

describe('createSearchCampaign', () => {
  it('short-circuits on client-side validation errors WITHOUT calling Google', async () => {
    const res = await createSearchCampaign({ ...spec, keywords: [], dailyBudgetEuros: 0 })
    expect(res.ok).toBe(false)
    expect(res.validationErrors?.length).toBeGreaterThan(0)
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('defaults to a dry run (validateOnly:true) and posts to googleAds:mutate', async () => {
    mockCall.mockResolvedValue(ok({ mutateOperationResponses: [] }))
    const res = await createSearchCampaign(spec)
    expect(res.validateOnly).toBe(true)
    expect(path()).toBe('customers/1234567890/googleAds:mutate')
    expect(body<{ validateOnly?: boolean }>().validateOnly).toBe(true)
  })

  it('parses the created campaign id out of the mutate response when live', async () => {
    mockCall.mockResolvedValue(
      ok({
        mutateOperationResponses: [
          { campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/55' } },
          { campaignResult: { resourceName: 'customers/1234567890/campaigns/987654' } },
        ],
      }),
    )
    const res = await createSearchCampaign(spec, { validateOnly: false })
    expect(res.ok).toBe(true)
    expect(res.validateOnly).toBe(false)
    expect(res.campaignId).toBe('987654')
    expect(body<{ validateOnly?: boolean }>().validateOnly).toBe(false)
  })
})

describe('setCampaignStatus', () => {
  it('builds an update with status + updateMask', async () => {
    mockCall.mockResolvedValue(ok({}))
    await setCampaignStatus('555', 'PAUSED')
    expect(path()).toBe('customers/1234567890/campaigns:mutate')
    const op = body<MutateBody>().operations?.[0]
    expect(op?.update?.resourceName).toBe('customers/1234567890/campaigns/555')
    expect(op?.update?.status).toBe('PAUSED')
    expect(op?.updateMask).toBe('status')
  })
})

describe('updateCampaignBudget', () => {
  it('looks up the budget then updates its amount in micros', async () => {
    mockCall
      .mockResolvedValueOnce(ok({ results: [{ campaignBudget: { resourceName: 'customers/1234567890/campaignBudgets/77' } }] }))
      .mockResolvedValueOnce(ok({}))
    const res = await updateCampaignBudget('555', 40)
    expect(res.ok).toBe(true)
    // 1st call = GAQL lookup, 2nd = the budget mutate
    expect(path(0)).toBe('customers/1234567890/googleAds:search')
    expect(path(1)).toBe('customers/1234567890/campaignBudgets:mutate')
    const op = body<MutateBody>(1).operations?.[0]
    expect(op?.update?.resourceName).toBe('customers/1234567890/campaignBudgets/77')
    expect(op?.update?.amountMicros).toBe('40000000')
    expect(op?.updateMask).toBe('amount_micros')
  })

  it('errors clearly when the campaign has no budget', async () => {
    mockCall.mockResolvedValueOnce(ok({ results: [] }))
    const res = await updateCampaignBudget('555', 40)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/No budget found/)
  })
})

describe('addKeywords', () => {
  it('creates one criterion per keyword with the chosen match type', async () => {
    mockCall.mockResolvedValue(ok({}))
    await addKeywords('333', ['private boat amsterdam', 'private cruise amsterdam'], 'PHRASE')
    expect(path()).toBe('customers/1234567890/adGroupCriteria:mutate')
    const ops = body<MutateBody>().operations ?? []
    expect(ops).toHaveLength(2)
    expect(ops[0].create?.adGroup).toBe('customers/1234567890/adGroups/333')
    expect((ops[0].create?.keyword as { matchType?: string }).matchType).toBe('PHRASE')
  })
})

describe('addNegativeKeywords', () => {
  it('creates BROAD negatives at the campaign level', async () => {
    mockCall.mockResolvedValue(ok({}))
    await addNegativeKeywords('555', ['houseboat', 'ferry'])
    expect(path()).toBe('customers/1234567890/campaignCriteria:mutate')
    const ops = body<MutateBody>().operations ?? []
    expect(ops).toHaveLength(2)
    expect(ops[0].create?.campaign).toBe('customers/1234567890/campaigns/555')
    expect(ops[0].create?.negative).toBe(true)
    expect((ops[0].create?.keyword as { matchType?: string }).matchType).toBe('BROAD')
  })
})
