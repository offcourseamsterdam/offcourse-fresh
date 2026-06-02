import { describe, it, expect } from 'vitest'
import {
  buildSearchCampaignOps,
  validateRsa,
  validateSpec,
  validateExtensions,
  type SearchCampaignSpec,
  type ResponsiveSearchAdSpec,
  type ExtensionsSpec,
} from './campaigns'
import { eurosToMicros, microsToEuros } from './campaign-client'
import { geoConstant, languageConstant } from './geo-constants'

const goodAd: ResponsiveSearchAdSpec = {
  headlines: ['Your Friend With a Boat', 'Private Cruise Amsterdam', 'Real Amsterdam by Water'],
  descriptions: [
    'Not a tour company — your friend with a boat. Private canal cruises, hidden gems.',
    'Electric boats, local skippers, zero pretension. Diana seats 8, Curaçao 12.',
  ],
  finalUrl: 'https://offcourseamsterdam.com/cruises/private',
}

const goodSpec: SearchCampaignSpec = {
  campaignName: 'Off Course — Private Canal Cruise',
  dailyBudgetEuros: 30,
  adGroupName: 'Private Boat — Amsterdam',
  keywords: ['private canal cruise amsterdam', 'private boat tour amsterdam'],
  matchType: 'PHRASE',
  negativeKeywords: ['self drive', 'cheap'],
  locations: ['Netherlands', 'Germany'],
  languages: ['English', 'Dutch'],
  ad: goodAd,
}

describe('money conversion', () => {
  it('euros → micros', () => {
    expect(eurosToMicros(30)).toBe(30_000_000)
    expect(eurosToMicros(0.5)).toBe(500_000)
    expect(eurosToMicros(165)).toBe(165_000_000)
  })
  it('micros → euros (accepts string, as Google returns)', () => {
    expect(microsToEuros('30000000')).toBe(30)
    expect(microsToEuros(1_500_000)).toBe(1.5)
  })
})

describe('geo + language constants', () => {
  it('resolves known countries case-insensitively', () => {
    expect(geoConstant('Netherlands')).toBe('geoTargetConstants/2528')
    expect(geoConstant('netherlands')).toBe('geoTargetConstants/2528')
    expect(geoConstant('USA')).toBe('geoTargetConstants/2840')
  })
  it('resolves known languages', () => {
    expect(languageConstant('English')).toBe('languageConstants/1000')
    expect(languageConstant('Dutch')).toBe('languageConstants/1010')
  })
  it('throws a helpful error for unknown names', () => {
    expect(() => geoConstant('Atlantis')).toThrow(/Unknown country/)
    expect(() => languageConstant('Klingon')).toThrow(/Unknown language/)
  })
})

describe('validateRsa', () => {
  it('passes a good ad', () => {
    expect(validateRsa(goodAd)).toEqual([])
  })
  it('flags too few headlines', () => {
    const errs = validateRsa({ ...goodAd, headlines: ['only one', 'two'] })
    expect(errs.some(e => /≥3 headlines/.test(e))).toBe(true)
  })
  it('flags an over-length headline', () => {
    const errs = validateRsa({ ...goodAd, headlines: ['x'.repeat(31), 'b', 'c'] })
    expect(errs.some(e => /31 chars/.test(e))).toBe(true)
  })
  it('flags an over-length description', () => {
    const errs = validateRsa({ ...goodAd, descriptions: ['x'.repeat(91), 'ok description here'] })
    expect(errs.some(e => /91 chars/.test(e))).toBe(true)
  })
  it('flags a non-http final URL', () => {
    const errs = validateRsa({ ...goodAd, finalUrl: 'offcourseamsterdam.com' })
    expect(errs.some(e => /finalUrl must start/.test(e))).toBe(true)
  })
})

describe('validateSpec', () => {
  it('passes a good spec', () => {
    expect(validateSpec(goodSpec)).toEqual([])
  })
  it('flags zero budget and no keywords', () => {
    const errs = validateSpec({ ...goodSpec, dailyBudgetEuros: 0, keywords: [] })
    expect(errs.some(e => /budget/i.test(e))).toBe(true)
    expect(errs.some(e => /at least one keyword/.test(e))).toBe(true)
  })
})

// A typed view of the atomic mutate payload, so tests can assert deep fields
// without `any`. Mirrors the operation shapes built by buildSearchCampaignOps.
interface OpCreate {
  resourceName?: string
  name?: string
  amountMicros?: string
  campaignBudget?: string
  status?: string
  advertisingChannelType?: string
  containsEuPoliticalAdvertising?: string
  maximizeConversions?: Record<string, string>
  networkSettings?: {
    targetGoogleSearch?: boolean
    targetSearchNetwork?: boolean
    targetContentNetwork?: boolean
    targetPartnerSearchNetwork?: boolean
  }
  campaign?: string
  adGroup?: string
  negative?: boolean
  location?: { geoTargetConstant?: string }
  language?: { languageConstant?: string }
  keyword?: { text?: string; matchType?: string }
  type?: string
  ad?: {
    finalUrls?: string[]
    responsiveSearchAd?: {
      headlines?: Array<{ text: string }>
      descriptions?: Array<{ text: string }>
      path1?: string
      path2?: string
    }
  }
  // extension asset fields
  finalUrls?: string[]
  sitelinkAsset?: { linkText?: string; description1?: string; description2?: string }
  calloutAsset?: { calloutText?: string }
  structuredSnippetAsset?: { header?: string; values?: string[] }
  asset?: string
  fieldType?: string
}
interface MutateOp {
  campaignBudgetOperation?: { create: OpCreate }
  campaignOperation?: { create: OpCreate }
  campaignCriterionOperation?: { create: OpCreate }
  adGroupOperation?: { create: OpCreate }
  adGroupCriterionOperation?: { create: OpCreate }
  adGroupAdOperation?: { create: OpCreate }
  assetOperation?: { create: OpCreate }
  campaignAssetOperation?: { create: OpCreate }
}
const ops = (spec: SearchCampaignSpec, validateOnly = true): MutateOp[] =>
  buildSearchCampaignOps(spec, '1234567890', validateOnly).mutateOperations as MutateOp[]

describe('buildSearchCampaignOps', () => {
  const CUST = '1234567890'
  const mutateOperations = ops(goodSpec)

  it('passes validateOnly through', () => {
    expect(buildSearchCampaignOps(goodSpec, CUST, true).validateOnly).toBe(true)
  })

  it('creates the budget with correct micros and links the campaign to it', () => {
    const budget = mutateOperations.find(o => o.campaignBudgetOperation)?.campaignBudgetOperation?.create
    expect(budget?.amountMicros).toBe('30000000')
    expect(budget?.resourceName).toBe(`customers/${CUST}/campaignBudgets/-1`)

    const campaign = mutateOperations.find(o => o.campaignOperation)?.campaignOperation?.create
    expect(campaign?.campaignBudget).toBe(`customers/${CUST}/campaignBudgets/-1`)
  })

  it('defaults to PAUSED, Search channel, partners + display OFF', () => {
    const c = mutateOperations.find(o => o.campaignOperation)?.campaignOperation?.create
    expect(c?.status).toBe('PAUSED')
    expect(c?.advertisingChannelType).toBe('SEARCH')
    expect(c?.networkSettings?.targetSearchNetwork).toBe(false)
    expect(c?.networkSettings?.targetContentNetwork).toBe(false)
    expect(c?.networkSettings?.targetGoogleSearch).toBe(true)
    expect(c?.maximizeConversions).toEqual({})
  })

  it('declares no EU political advertising (required by Google since 2025)', () => {
    const c = mutateOperations.find(o => o.campaignOperation)?.campaignOperation?.create
    expect(c?.containsEuPoliticalAdvertising).toBe('DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING')
  })

  it('honours startPaused:false → ENABLED', () => {
    const c = ops({ ...goodSpec, startPaused: false }, false).find(o => o.campaignOperation)
      ?.campaignOperation?.create
    expect(c?.status).toBe('ENABLED')
  })

  it('uses Target CPA bidding when targetCpaEuros is set', () => {
    const c = ops({ ...goodSpec, targetCpaEuros: 25 }).find(o => o.campaignOperation)?.campaignOperation
      ?.create
    expect(c?.maximizeConversions).toEqual({ targetCpaMicros: '25000000' })
  })

  it('creates one criterion per location and language', () => {
    const locOps = mutateOperations.filter(o => o.campaignCriterionOperation?.create?.location)
    const langOps = mutateOperations.filter(o => o.campaignCriterionOperation?.create?.language)
    expect(locOps).toHaveLength(2)
    expect(langOps).toHaveLength(2)
    expect(locOps[0].campaignCriterionOperation?.create.location?.geoTargetConstant).toBe(
      'geoTargetConstants/2528',
    )
  })

  it('creates campaign-level negatives as BROAD', () => {
    const negOps = mutateOperations.filter(o => o.campaignCriterionOperation?.create?.negative === true)
    expect(negOps).toHaveLength(2)
    expect(negOps[0].campaignCriterionOperation?.create.keyword?.matchType).toBe('BROAD')
  })

  it('creates one keyword criterion per keyword with the chosen match type', () => {
    const kwOps = mutateOperations.filter(o => o.adGroupCriterionOperation)
    expect(kwOps).toHaveLength(2)
    expect(kwOps[0].adGroupCriterionOperation?.create.keyword?.matchType).toBe('PHRASE')
    expect(kwOps[0].adGroupCriterionOperation?.create.adGroup).toBe(`customers/${CUST}/adGroups/-3`)
  })

  it('builds exactly one RSA mapping headlines + descriptions', () => {
    const adOps = mutateOperations.filter(o => o.adGroupAdOperation)
    expect(adOps).toHaveLength(1)
    const ad = adOps[0].adGroupAdOperation?.create.ad
    expect(ad?.responsiveSearchAd?.headlines).toEqual([
      { text: 'Your Friend With a Boat' },
      { text: 'Private Cruise Amsterdam' },
      { text: 'Real Amsterdam by Water' },
    ])
    expect(ad?.responsiveSearchAd?.descriptions).toHaveLength(2)
    expect(ad?.finalUrls).toEqual(['https://offcourseamsterdam.com/cruises/private'])
  })

  it('orders operations so dependencies exist before they are referenced', () => {
    // budget before campaign, campaign before ad group, ad group before keywords/ad
    const order = mutateOperations.map(o => Object.keys(o)[0])
    expect(order.indexOf('campaignBudgetOperation')).toBeLessThan(order.indexOf('campaignOperation'))
    expect(order.indexOf('campaignOperation')).toBeLessThan(order.indexOf('adGroupOperation'))
    expect(order.indexOf('adGroupOperation')).toBeLessThan(order.lastIndexOf('adGroupCriterionOperation'))
    expect(order.indexOf('adGroupOperation')).toBeLessThan(order.indexOf('adGroupAdOperation'))
  })
})

describe('exact-match keywords', () => {
  it('adds exactKeywords as EXACT alongside phrase keywords', () => {
    const spec = { ...goodSpec, keywords: ['private boat amsterdam'], exactKeywords: ['private canal cruise amsterdam'] }
    const kwOps = ops(spec).filter(o => o.adGroupCriterionOperation)
    const byMatch = kwOps.map(o => o.adGroupCriterionOperation!.create.keyword)
    expect(byMatch).toContainEqual({ text: 'private boat amsterdam', matchType: 'PHRASE' })
    expect(byMatch).toContainEqual({ text: 'private canal cruise amsterdam', matchType: 'EXACT' })
  })
  it('a spec with only exactKeywords still validates', () => {
    expect(validateSpec({ ...goodSpec, keywords: [], exactKeywords: ['private boat amsterdam'] })).toEqual([])
  })
})

describe('validateExtensions', () => {
  const good: ExtensionsSpec = {
    sitelinks: [{ text: 'Private Boats', description1: 'Diana or Curaçao', description2: 'Up to 12 guests', finalUrl: 'https://offcourseamsterdam.com/cruises' }],
    callouts: ['Electric & silent', 'Local skippers'],
    snippets: [{ header: 'Types', values: ['Private', 'Sunset', 'Hidden Gems'] }],
  }
  it('passes a good set', () => {
    expect(validateExtensions(good)).toEqual([])
  })
  it('flags over-length sitelink text and callouts', () => {
    const errs = validateExtensions({ sitelinks: [{ text: 'x'.repeat(26), finalUrl: 'https://a.com' }], callouts: ['y'.repeat(26)] })
    expect(errs.some(e => /Sitelink 1 text is 26/.test(e))).toBe(true)
    expect(errs.some(e => /Callout 1 is 26/.test(e))).toBe(true)
  })
  it('rejects a disallowed snippet header and too-few values', () => {
    const errs = validateExtensions({ snippets: [{ header: 'Vibes', values: ['a', 'b'] }] })
    expect(errs.some(e => /header "Vibes" not allowed/.test(e))).toBe(true)
    expect(errs.some(e => /needs ≥3 values/.test(e))).toBe(true)
  })
})

describe('buildSearchCampaignOps — extensions', () => {
  const CUST = '1234567890'
  const withExt: SearchCampaignSpec = {
    ...goodSpec,
    extensions: {
      sitelinks: [
        { text: 'Private Boats', description1: 'Diana or Curaçao', description2: 'Up to 12 guests', finalUrl: 'https://offcourseamsterdam.com/cruises' },
        { text: 'Book a Date', finalUrl: 'https://offcourseamsterdam.com/book' },
      ],
      callouts: ['Electric & silent', 'Local skippers', 'No tourist routes'],
      snippets: [{ header: 'Types', values: ['Private', 'Sunset', 'Hidden Gems'] }],
    },
  }
  const out = ops(withExt)

  it('creates an asset + a campaignAsset for each extension', () => {
    const assets = out.filter(o => o.assetOperation)
    const links = out.filter(o => o.campaignAssetOperation)
    // 2 sitelinks + 3 callouts + 1 snippet = 6 of each
    expect(assets).toHaveLength(6)
    expect(links).toHaveLength(6)
  })

  it('builds the sitelink asset + links it with fieldType SITELINK', () => {
    const sitelinkAsset = out.find(o => o.assetOperation?.create.sitelinkAsset)?.assetOperation?.create
    expect(sitelinkAsset?.sitelinkAsset?.linkText).toBe('Private Boats')
    expect(sitelinkAsset?.finalUrls).toEqual(['https://offcourseamsterdam.com/cruises'])
    expect(out.some(o => o.campaignAssetOperation?.create.fieldType === 'SITELINK')).toBe(true)
  })

  it('builds callout + structured snippet assets with the right field types', () => {
    expect(out.some(o => o.assetOperation?.create.calloutAsset?.calloutText === 'Electric & silent')).toBe(true)
    expect(out.some(o => o.campaignAssetOperation?.create.fieldType === 'CALLOUT')).toBe(true)
    const snippet = out.find(o => o.assetOperation?.create.structuredSnippetAsset)?.assetOperation?.create.structuredSnippetAsset
    expect(snippet?.header).toBe('Types')
    expect(snippet?.values).toEqual(['Private', 'Sunset', 'Hidden Gems'])
    expect(out.some(o => o.campaignAssetOperation?.create.fieldType === 'STRUCTURED_SNIPPET')).toBe(true)
  })

  it('links every asset to the campaign', () => {
    const links = out.filter(o => o.campaignAssetOperation)
    expect(links.every(o => o.campaignAssetOperation!.create.campaign === `customers/${CUST}/campaigns/-2`)).toBe(true)
  })

  it('omits asset operations entirely when no extensions are given', () => {
    expect(ops(goodSpec).some(o => o.assetOperation || o.campaignAssetOperation)).toBe(false)
  })
})
