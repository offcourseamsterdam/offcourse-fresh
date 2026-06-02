import { googleAdsCall, microsToEuros } from './campaign-client'

// Google Ads KeywordPlanIdeaService — programmatic Keyword Planner.
// Returns real search volumes, competition levels, and estimated CPCs
// directly from Google's own data for any seed keywords.
//
// REST endpoint: POST customers/{id}/keywordPlanIdeas:generateKeywordIdeas
// Docs: https://developers.google.com/google-ads/api/reference/rpc/v20/KeywordPlanIdeaService

export type Competition = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNSPECIFIED'

export interface KeywordIdea {
  text: string
  avgMonthlySearches: number | null
  competition: Competition
  /** Estimated top-of-page bid, low end (euros) */
  lowTopOfPageBidEuros: number | null
  /** Estimated top-of-page bid, high end (euros) */
  highTopOfPageBidEuros: number | null
  /** Estimated average CPC (euros) */
  avgCpcEuros: number | null
}

export interface KeywordResearchResult {
  ok: boolean
  ideas?: KeywordIdea[]
  error?: string
}

/**
 * Generate keyword ideas from seed keywords.
 * Uses Google's actual search data — more reliable than third-party tools.
 *
 * @param seedKeywords  2–20 seed terms to expand from
 * @param languageId    languageConstant id (1000 = English, 1010 = Dutch)
 * @param geoIds        geoTargetConstant ids (2528 = Netherlands, 2826 = UK, 2840 = US)
 */
export async function generateKeywordIdeas(
  seedKeywords: string[],
  languageId = 1000,
  geoIds: number[] = [2528, 2826, 2840],
): Promise<KeywordResearchResult> {
  const { getCampaignConfig } = await import('./campaign-client')
  const cfg = getCampaignConfig()
  if ('error' in cfg) return { ok: false, error: cfg.error }

  const body = {
    keywordSeed: { keywords: seedKeywords },
    language: `languageConstants/${languageId}`,
    geoTargetConstants: geoIds.map(id => `geoTargetConstants/${id}`),
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    includeAdultKeywords: false,
  }

  const res = await googleAdsCall<{ results?: RawKeywordIdea[] }>(
    `customers/${cfg.customerId}/keywordPlanIdeas:generateKeywordIdeas`,
    { method: 'POST', body },
  )

  if (!res.ok) return { ok: false, error: res.error }

  const ideas = (res.data?.results ?? [])
    .map(parseIdea)
    .filter((k): k is KeywordIdea => k !== null)
    // Sort by monthly searches descending, unspecified last
    .sort((a, b) => (b.avgMonthlySearches ?? -1) - (a.avgMonthlySearches ?? -1))

  return { ok: true, ideas }
}

// ── Internal: parse the raw API response shape ────────────────────────────────

interface RawMetrics {
  avgMonthlySearches?: string | number
  competition?: string
  competitionIndex?: string | number
  lowTopOfPageBidMicros?: string | number
  highTopOfPageBidMicros?: string | number
  averageCpcMicros?: string | number
}

interface RawKeywordIdea {
  text?: string
  keywordIdeaMetrics?: RawMetrics
}

function parseIdea(raw: RawKeywordIdea): KeywordIdea | null {
  if (!raw.text) return null
  const m = raw.keywordIdeaMetrics ?? {}
  const searches = m.avgMonthlySearches ? Number(m.avgMonthlySearches) : null
  const low = m.lowTopOfPageBidMicros ? microsToEuros(m.lowTopOfPageBidMicros) : null
  const high = m.highTopOfPageBidMicros ? microsToEuros(m.highTopOfPageBidMicros) : null
  const cpc = m.averageCpcMicros ? microsToEuros(m.averageCpcMicros) : null
  const competition = (['LOW', 'MEDIUM', 'HIGH'].includes(m.competition ?? '') ? m.competition : 'UNSPECIFIED') as Competition

  return { text: raw.text, avgMonthlySearches: searches, competition, lowTopOfPageBidEuros: low, highTopOfPageBidEuros: high, avgCpcEuros: cpc }
}
