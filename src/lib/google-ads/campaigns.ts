import { googleAdsCall, eurosToMicros, customerPath, getCampaignConfig, type AdsCallResult } from './campaign-client'
import { geoConstant, languageConstant } from './geo-constants'

// Campaign management for Google Ads Search campaigns.
//
// Design choices:
//  • ATOMIC creation — the entire campaign (budget → campaign → targeting →
//    ad group → keywords → negatives → ad) is sent as ONE googleAds:mutate request
//    using temporary resource names (negative ids). It's all-or-nothing: a failure
//    at any step rolls the whole thing back, so we never leave an orphaned budget
//    or half-built campaign in the account.
//  • validateOnly — every create supports a dry run that asks Google to validate
//    the whole graph without persisting anything. Always run this first.
//  • Pure builders — buildSearchCampaignOps() returns the request payload with no
//    I/O, so it's fully unit-testable (campaigns.test.ts).

export type MatchType = 'PHRASE' | 'EXACT' | 'BROAD'

export interface ResponsiveSearchAdSpec {
  /** 3–15 headlines, each ≤30 chars. */
  headlines: string[]
  /** 2–4 descriptions, each ≤90 chars. */
  descriptions: string[]
  finalUrl: string
  /** Optional display-URL path segments, each ≤15 chars (e.g. "private" / "cruise"). */
  path1?: string
  path2?: string
}

// ── Ad extensions (Google Ads "assets") ─────────────────────────────────────────
// Extensions are now "assets" linked to the campaign. They add deep links, selling
// points, and feature lists under the ad — competitors (e.g. Boatnow) use all of
// them, and an ad without them looks bare. We support the three text types that
// matter most for a Search ad: sitelinks, callouts, structured snippets.

export interface SitelinkSpec {
  /** Blue link text, ≤25 chars. */
  text: string
  /** Two optional description lines under the link, ≤35 chars each. */
  description1?: string
  description2?: string
  finalUrl: string
}

export interface StructuredSnippetSpec {
  /** A Google-approved header, e.g. "Types", "Amenities", "Featured", "Services". */
  header: string
  /** 3–10 values, ≤25 chars each. */
  values: string[]
}

export interface ExtensionsSpec {
  /** Extra deep links under the ad (Google wants ≥2 to show; ≥4 recommended). */
  sitelinks?: SitelinkSpec[]
  /** Short selling-point phrases, ≤25 chars each (≥4 recommended). */
  callouts?: string[]
  /** Feature lists, e.g. "Types: Private, Sunset, Hidden Gems". */
  snippets?: StructuredSnippetSpec[]
}

export interface SearchCampaignSpec {
  campaignName: string
  /** Daily budget in euros (major units). Stored as micros internally. */
  dailyBudgetEuros: number
  /** Maximize Conversions is the default; pass targetCpaEuros to cap cost-per-booking. */
  targetCpaEuros?: number
  adGroupName: string
  /** Keyword texts (the match type is applied uniformly via `matchType`). */
  keywords: string[]
  matchType: MatchType
  /** Core terms to ALSO add in EXACT match (best practice: exact on proven head terms). */
  exactKeywords?: string[]
  /** Campaign-level negative keywords (applied BROAD). */
  negativeKeywords?: string[]
  /** Country names — resolved to geoTargetConstants. */
  locations: string[]
  /** Language names — resolved to languageConstants. */
  languages: string[]
  ad: ResponsiveSearchAdSpec
  /** Ad extensions (sitelinks, callouts, structured snippets). */
  extensions?: ExtensionsSpec
  /** Create PAUSED (default, safest) or ENABLED. */
  startPaused?: boolean
}

/** Headers Google allows for structured snippets. */
export const SNIPPET_HEADERS = [
  'Amenities', 'Brands', 'Courses', 'Degree programs', 'Destinations', 'Featured',
  'Insurance coverage', 'Models', 'Neighborhoods', 'Services', 'Shows', 'Styles', 'Types',
]

// ── Validation (catch problems before Google does, with friendly messages) ──────

export function validateRsa(ad: ResponsiveSearchAdSpec): string[] {
  const errors: string[] = []
  if (ad.headlines.length < 3) errors.push(`Need ≥3 headlines (have ${ad.headlines.length}).`)
  if (ad.headlines.length > 15) errors.push(`Max 15 headlines (have ${ad.headlines.length}).`)
  if (ad.descriptions.length < 2) errors.push(`Need ≥2 descriptions (have ${ad.descriptions.length}).`)
  if (ad.descriptions.length > 4) errors.push(`Max 4 descriptions (have ${ad.descriptions.length}).`)
  ad.headlines.forEach((h, i) => {
    if (h.length > 30) errors.push(`Headline ${i + 1} is ${h.length} chars (max 30): "${h}"`)
    if (h.trim() === '') errors.push(`Headline ${i + 1} is empty.`)
  })
  ad.descriptions.forEach((d, i) => {
    if (d.length > 90) errors.push(`Description ${i + 1} is ${d.length} chars (max 90): "${d}"`)
    if (d.trim() === '') errors.push(`Description ${i + 1} is empty.`)
  })
  if (ad.path1 && ad.path1.length > 15) errors.push(`path1 "${ad.path1}" is >15 chars.`)
  if (ad.path2 && ad.path2.length > 15) errors.push(`path2 "${ad.path2}" is >15 chars.`)
  if (!/^https?:\/\//.test(ad.finalUrl)) errors.push(`finalUrl must start with http(s)://: "${ad.finalUrl}"`)
  return errors
}

export function validateExtensions(ext?: ExtensionsSpec): string[] {
  const errors: string[] = []
  if (!ext) return errors
  ext.sitelinks?.forEach((s, i) => {
    if (s.text.length > 25) errors.push(`Sitelink ${i + 1} text is ${s.text.length} chars (max 25): "${s.text}"`)
    if (!s.text.trim()) errors.push(`Sitelink ${i + 1} text is empty.`)
    if (s.description1 && s.description1.length > 35) errors.push(`Sitelink ${i + 1} description1 >35 chars.`)
    if (s.description2 && s.description2.length > 35) errors.push(`Sitelink ${i + 1} description2 >35 chars.`)
    if (!/^https?:\/\//.test(s.finalUrl)) errors.push(`Sitelink ${i + 1} finalUrl must start with http(s)://.`)
  })
  ext.callouts?.forEach((c, i) => {
    if (c.length > 25) errors.push(`Callout ${i + 1} is ${c.length} chars (max 25): "${c}"`)
  })
  ext.snippets?.forEach((sn, i) => {
    if (!SNIPPET_HEADERS.includes(sn.header)) errors.push(`Snippet ${i + 1} header "${sn.header}" not allowed. Use one of: ${SNIPPET_HEADERS.join(', ')}.`)
    if (sn.values.length < 3) errors.push(`Snippet ${i + 1} needs ≥3 values (has ${sn.values.length}).`)
    sn.values.forEach((v, j) => {
      if (v.length > 25) errors.push(`Snippet ${i + 1} value ${j + 1} >25 chars: "${v}"`)
    })
  })
  return errors
}

export function validateSpec(spec: SearchCampaignSpec): string[] {
  const errors: string[] = []
  if (!spec.campaignName.trim()) errors.push('campaignName is required.')
  if (!(spec.dailyBudgetEuros > 0)) errors.push('dailyBudgetEuros must be > 0.')
  if (spec.keywords.length === 0 && (spec.exactKeywords?.length ?? 0) === 0) errors.push('Need at least one keyword.')
  if (spec.locations.length === 0) errors.push('Need at least one location.')
  if (spec.languages.length === 0) errors.push('Need at least one language.')
  errors.push(...validateRsa(spec.ad))
  errors.push(...validateExtensions(spec.extensions))
  return errors
}

// ── Pure builder: the atomic mutateOperations payload ───────────────────────────

/**
 * Build the googleAds:mutate body that creates an entire Search campaign atomically.
 * Temp resource names: budget=-1, campaign=-2, adGroup=-3 (all under the customer).
 */
export function buildSearchCampaignOps(
  spec: SearchCampaignSpec,
  customerId: string,
  validateOnly: boolean,
): {
  mutateOperations: unknown[]
  validateOnly: boolean
} {
  const cust = `customers/${customerId}`
  const budgetRes = `${cust}/campaignBudgets/-1`
  const campaignRes = `${cust}/campaigns/-2`
  const adGroupRes = `${cust}/adGroups/-3`

  const bidding =
    spec.targetCpaEuros && spec.targetCpaEuros > 0
      ? { maximizeConversions: { targetCpaMicros: String(eurosToMicros(spec.targetCpaEuros)) } }
      : { maximizeConversions: {} }

  const ops: unknown[] = []

  // 1) Budget
  ops.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budgetRes,
        name: `${spec.campaignName} — budget`,
        amountMicros: String(eurosToMicros(spec.dailyBudgetEuros)),
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  })

  // 2) Campaign
  ops.push({
    campaignOperation: {
      create: {
        resourceName: campaignRes,
        name: spec.campaignName,
        status: spec.startPaused === false ? 'ENABLED' : 'PAUSED',
        advertisingChannelType: 'SEARCH',
        campaignBudget: budgetRes,
        // EU regulation (since 2025): every campaign must declare this. A canal-cruise
        // ad is obviously not political advertising.
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        ...bidding,
        networkSettings: {
          targetGoogleSearch: true,
          targetSearchNetwork: false, // Search partners OFF (your strategy)
          targetContentNetwork: false, // Display OFF
          targetPartnerSearchNetwork: false,
        },
      },
    },
  })

  // 3) Targeting — locations + languages (campaign criteria)
  for (const loc of spec.locations) {
    ops.push({
      campaignCriterionOperation: {
        create: { campaign: campaignRes, location: { geoTargetConstant: geoConstant(loc) } },
      },
    })
  }
  for (const lang of spec.languages) {
    ops.push({
      campaignCriterionOperation: {
        create: { campaign: campaignRes, language: { languageConstant: languageConstant(lang) } },
      },
    })
  }

  // 4) Negative keywords (campaign-level, BROAD)
  for (const neg of spec.negativeKeywords ?? []) {
    ops.push({
      campaignCriterionOperation: {
        create: { campaign: campaignRes, negative: true, keyword: { text: neg, matchType: 'BROAD' } },
      },
    })
  }

  // 5) Ad group
  ops.push({
    adGroupOperation: {
      create: {
        resourceName: adGroupRes,
        name: spec.adGroupName,
        campaign: campaignRes,
        status: 'ENABLED',
        type: 'SEARCH_STANDARD',
      },
    },
  })

  // 6) Keywords — phrase (or chosen match type)
  for (const kw of spec.keywords) {
    ops.push({
      adGroupCriterionOperation: {
        create: { adGroup: adGroupRes, status: 'ENABLED', keyword: { text: kw, matchType: spec.matchType } },
      },
    })
  }

  // 6b) Core keywords in EXACT match (best practice: exact on proven head terms)
  for (const kw of spec.exactKeywords ?? []) {
    ops.push({
      adGroupCriterionOperation: {
        create: { adGroup: adGroupRes, status: 'ENABLED', keyword: { text: kw, matchType: 'EXACT' } },
      },
    })
  }

  // 7) Responsive Search Ad
  const rsa: Record<string, unknown> = {
    headlines: spec.ad.headlines.map(text => ({ text })),
    descriptions: spec.ad.descriptions.map(text => ({ text })),
  }
  if (spec.ad.path1) rsa.path1 = spec.ad.path1
  if (spec.ad.path2) rsa.path2 = spec.ad.path2
  ops.push({
    adGroupAdOperation: {
      create: {
        adGroup: adGroupRes,
        status: 'ENABLED',
        ad: { finalUrls: [spec.ad.finalUrl], responsiveSearchAd: rsa },
      },
    },
  })

  // 8) Ad extensions (assets created + linked at campaign level). Asset temp ids
  // start at -10 to avoid colliding with budget/-1, campaign/-2, adGroup/-3.
  let assetId = -10
  const ext = spec.extensions
  if (ext) {
    for (const s of ext.sitelinks ?? []) {
      const a = `${cust}/assets/${assetId--}`
      const sitelinkAsset: Record<string, unknown> = { linkText: s.text }
      if (s.description1) sitelinkAsset.description1 = s.description1
      if (s.description2) sitelinkAsset.description2 = s.description2
      ops.push({ assetOperation: { create: { resourceName: a, finalUrls: [s.finalUrl], sitelinkAsset } } })
      ops.push({ campaignAssetOperation: { create: { campaign: campaignRes, asset: a, fieldType: 'SITELINK' } } })
    }
    for (const c of ext.callouts ?? []) {
      const a = `${cust}/assets/${assetId--}`
      ops.push({ assetOperation: { create: { resourceName: a, calloutAsset: { calloutText: c } } } })
      ops.push({ campaignAssetOperation: { create: { campaign: campaignRes, asset: a, fieldType: 'CALLOUT' } } })
    }
    for (const sn of ext.snippets ?? []) {
      const a = `${cust}/assets/${assetId--}`
      ops.push({ assetOperation: { create: { resourceName: a, structuredSnippetAsset: { header: sn.header, values: sn.values } } } })
      ops.push({ campaignAssetOperation: { create: { campaign: campaignRes, asset: a, fieldType: 'STRUCTURED_SNIPPET' } } })
    }
  }

  return { mutateOperations: ops, validateOnly }
}

// ── Orchestrators (do the I/O) ──────────────────────────────────────────────────

/** Resolve the customer resource path and numeric customer id in one call. */
function custIds() {
  const cust = customerPath()
  return { cust, customerId: cust.split('/')[1] }
}

export interface CreateCampaignResult {
  ok: boolean
  validateOnly: boolean
  /** Created campaign resource name, when live + successful. */
  campaignResourceName?: string
  campaignId?: string
  error?: string
  /** Client-side validation errors (never even sent to Google). */
  validationErrors?: string[]
  raw?: unknown
}

/**
 * Create a Search campaign. Defaults to validateOnly (dry run) — pass
 * { validateOnly: false } to actually create it.
 */
export async function createSearchCampaign(
  spec: SearchCampaignSpec,
  opts: { validateOnly?: boolean } = {},
): Promise<CreateCampaignResult> {
  const validateOnly = opts.validateOnly !== false // default true (safe)

  const validationErrors = validateSpec(spec)
  if (validationErrors.length > 0) {
    return { ok: false, validateOnly, validationErrors }
  }

  const cfg = getCampaignConfig()
  if ('error' in cfg) return { ok: false, validateOnly, error: cfg.error }

  let body: ReturnType<typeof buildSearchCampaignOps>
  try {
    body = buildSearchCampaignOps(spec, cfg.customerId, validateOnly)
  } catch (err) {
    // Thrown by geo/language constant lookups for unknown names.
    return { ok: false, validateOnly, error: err instanceof Error ? err.message : String(err) }
  }

  const res = await googleAdsCall<{
    mutateOperationResponses?: Array<{ campaignResult?: { resourceName?: string } }>
  }>(`customers/${cfg.customerId}/googleAds:mutate`, { method: 'POST', body })

  if (!res.ok) return { ok: false, validateOnly, error: res.error, raw: res.raw }

  // Find the campaign result among the per-operation responses.
  const responses = res.data?.mutateOperationResponses ?? []
  const campaignResourceName = responses.find(r => r.campaignResult?.resourceName)?.campaignResult
    ?.resourceName
  const campaignId = campaignResourceName?.split('/').pop()

  return { ok: true, validateOnly, campaignResourceName, campaignId, raw: res.data }
}

/** Pause or enable a campaign by numeric id. */
export async function setCampaignStatus(
  campaignId: string,
  status: 'ENABLED' | 'PAUSED',
): Promise<AdsCallResult> {
  const { cust, customerId } = custIds()
  return googleAdsCall(`customers/${customerId}/campaigns:mutate`, {
    method: 'POST',
    body: {
      operations: [
        { update: { resourceName: `${cust}/campaigns/${campaignId}`, status }, updateMask: 'status' },
      ],
    },
  })
}

/** Change a campaign's daily budget. Looks up the budget resource, then updates it. */
export async function updateCampaignBudget(
  campaignId: string,
  newDailyEuros: number,
): Promise<AdsCallResult> {
  const { cust, customerId } = custIds()

  // Find the budget attached to this campaign.
  const q = `SELECT campaign.id, campaign_budget.resource_name FROM campaign WHERE campaign.id = ${Number(campaignId)}`
  const search = await googleAdsCall<{
    results?: Array<{ campaignBudget?: { resourceName?: string } }>
  }>(`customers/${customerId}/googleAds:search`, { method: 'POST', body: { query: q } })
  if (!search.ok) return search
  const budgetResource = search.data?.results?.[0]?.campaignBudget?.resourceName
  if (!budgetResource) {
    return { ok: false, status: 0, error: `No budget found for campaign ${campaignId}.` }
  }

  return googleAdsCall(`customers/${customerId}/campaignBudgets:mutate`, {
    method: 'POST',
    body: {
      operations: [
        {
          update: { resourceName: budgetResource, amountMicros: String(eurosToMicros(newDailyEuros)) },
          updateMask: 'amount_micros',
        },
      ],
    },
  })
}

/** Add positive keywords to an existing ad group. */
export async function addKeywords(
  adGroupId: string,
  keywords: string[],
  matchType: MatchType,
  opts: { validateOnly?: boolean } = {},
): Promise<AdsCallResult> {
  const { cust, customerId } = custIds()
  return googleAdsCall(`customers/${customerId}/adGroupCriteria:mutate`, {
    method: 'POST',
    body: {
      operations: keywords.map(text => ({
        create: { adGroup: `${cust}/adGroups/${adGroupId}`, status: 'ENABLED', keyword: { text, matchType } },
      })),
      validateOnly: opts.validateOnly ?? false,
    },
  })
}

/** Add campaign-level negative keywords (applied BROAD). */
export async function addNegativeKeywords(
  campaignId: string,
  negatives: string[],
  opts: { validateOnly?: boolean } = {},
): Promise<AdsCallResult> {
  const { cust, customerId } = custIds()
  return googleAdsCall(`customers/${customerId}/campaignCriteria:mutate`, {
    method: 'POST',
    body: {
      operations: negatives.map(text => ({
        create: { campaign: `${cust}/campaigns/${campaignId}`, negative: true, keyword: { text, matchType: 'BROAD' } },
      })),
      validateOnly: opts.validateOnly ?? false,
    },
  })
}
