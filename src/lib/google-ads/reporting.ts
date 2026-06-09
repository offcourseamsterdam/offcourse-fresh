import { googleAdsCall, microsToEuros } from './campaign-client'

// Read-side: GAQL (Google Ads Query Language) queries via googleAds:search.
// Every metric comes back in micros / raw counts; we convert money to euros and
// derive the ratios a human actually wants (CTR, cost-per-conversion, ROAS).

export interface QueryResult<T> {
  ok: boolean
  rows?: T[]
  error?: string
}

/**
 * Loose shape of a GAQL result row — the union of every field any query below
 * selects. Google returns deeply-nested camelCase objects; we read defensively
 * with optional chaining, so every field is optional.
 */
interface GaqlRow {
  campaign?: { id?: number | string; name?: string; status?: string; advertisingChannelType?: string }
  campaignBudget?: { amountMicros?: number | string; resourceName?: string }
  adGroup?: { name?: string }
  adGroupCriterion?: { keyword?: { text?: string; matchType?: string }; status?: string }
  searchTermView?: { searchTerm?: string }
  metrics?: {
    impressions?: number | string
    clicks?: number | string
    ctr?: number | string
    costMicros?: number | string
    conversions?: number | string
    conversionsValue?: number | string
    averageCpc?: number | string
  }
}

/** YYYY-MM-DD for `n` days ago (0 = today), local calendar date. */
function ymd(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

/** GAQL BETWEEN clause covering the last `days` calendar days (inclusive of today). */
function lastNDays(days: number): string {
  return `segments.date BETWEEN '${ymd(Math.max(1, days) - 1)}' AND '${ymd(0)}'`
}

/** GAQL WHERE clause: date range + optional campaign filter. */
function campaignWhere(days: number, campaignId?: string): string {
  return [lastNDays(days), campaignId ? `campaign.id = ${Number(campaignId)}` : '']
    .filter(Boolean)
    .join(' AND ')
}

async function customerId(): Promise<string | { error: string }> {
  const { getCampaignConfig } = await import('./campaign-client')
  const cfg = getCampaignConfig()
  if ('error' in cfg) return { error: cfg.error }
  return cfg.customerId
}

async function runQuery<T>(query: string, map: (r: GaqlRow) => T): Promise<QueryResult<T>> {
  const cid = await customerId()
  if (typeof cid !== 'string') return { ok: false, error: cid.error }
  const res = await googleAdsCall<{ results?: GaqlRow[] }>(`customers/${cid}/googleAds:search`, {
    method: 'POST',
    body: { query },
  })
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, rows: (res.data?.results ?? []).map(map) }
}

// ── Accounts (auth sanity check) ────────────────────────────────────────────────

export async function listAccessibleCustomers(): Promise<QueryResult<string>> {
  const res = await googleAdsCall<{ resourceNames?: string[] }>('customers:listAccessibleCustomers', {
    method: 'GET',
  })
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, rows: (res.data?.resourceNames ?? []).map(n => n.split('/').pop() as string) }
}

// ── Campaigns ───────────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string
  name: string
  status: string
  channelType: string
  dailyBudgetEuros: number
}

export async function listCampaigns(): Promise<QueryResult<CampaignRow>> {
  const query = `
    SELECT campaign.id, campaign.name, campaign.status,
           campaign.advertising_channel_type, campaign_budget.amount_micros
    FROM campaign
    ORDER BY campaign.id`
  return runQuery<CampaignRow>(query, r => ({
    id: String(r.campaign?.id ?? ''),
    name: r.campaign?.name ?? '',
    status: r.campaign?.status ?? '',
    channelType: r.campaign?.advertisingChannelType ?? '',
    dailyBudgetEuros: microsToEuros(r.campaignBudget?.amountMicros ?? 0),
  }))
}

// ── Performance ─────────────────────────────────────────────────────────────────

export interface PerformanceRow {
  id: string
  name: string
  impressions: number
  clicks: number
  ctr: number // %
  costEuros: number
  conversions: number
  conversionValueEuros: number
  avgCpcEuros: number
  costPerConversionEuros: number | null
  roas: number | null // conversion value / cost
}

export async function campaignPerformance(days = 30): Promise<QueryResult<PerformanceRow>> {
  const query = `
    SELECT campaign.id, campaign.name,
           metrics.impressions, metrics.clicks, metrics.ctr,
           metrics.cost_micros, metrics.conversions, metrics.conversions_value,
           metrics.average_cpc
    FROM campaign
    WHERE ${lastNDays(days)}
    ORDER BY metrics.cost_micros DESC`
  return runQuery<PerformanceRow>(query, r => {
    const costEuros = microsToEuros(r.metrics?.costMicros ?? 0)
    const conversions = Number(r.metrics?.conversions ?? 0)
    const conversionValueEuros = Number(r.metrics?.conversionsValue ?? 0)
    return {
      id: String(r.campaign?.id ?? ''),
      name: r.campaign?.name ?? '',
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      ctr: Number(r.metrics?.ctr ?? 0) * 100,
      costEuros,
      conversions,
      conversionValueEuros,
      avgCpcEuros: microsToEuros(r.metrics?.averageCpc ?? 0),
      costPerConversionEuros: conversions > 0 ? costEuros / conversions : null,
      roas: costEuros > 0 ? conversionValueEuros / costEuros : null,
    }
  })
}

// ── Keywords ────────────────────────────────────────────────────────────────────

export interface KeywordRow {
  text: string
  matchType: string
  status: string
  adGroup: string
  impressions: number
  clicks: number
  conversions: number
  costEuros: number
}

export async function listKeywords(campaignId?: string, days = 30): Promise<QueryResult<KeywordRow>> {
  const where = campaignWhere(days, campaignId)
  const query = `
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           ad_group_criterion.status, ad_group.name,
           metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
    FROM keyword_view
    WHERE ${where}
    ORDER BY metrics.cost_micros DESC`
  return runQuery<KeywordRow>(query, r => ({
    text: r.adGroupCriterion?.keyword?.text ?? '',
    matchType: r.adGroupCriterion?.keyword?.matchType ?? '',
    status: r.adGroupCriterion?.status ?? '',
    adGroup: r.adGroup?.name ?? '',
    impressions: Number(r.metrics?.impressions ?? 0),
    clicks: Number(r.metrics?.clicks ?? 0),
    conversions: Number(r.metrics?.conversions ?? 0),
    costEuros: microsToEuros(r.metrics?.costMicros ?? 0),
  }))
}

// ── Search terms (the real queries → find negatives) ────────────────────────────

export interface SearchTermRow {
  term: string
  impressions: number
  clicks: number
  conversions: number
  costEuros: number
}

export async function searchTerms(campaignId?: string, days = 30): Promise<QueryResult<SearchTermRow>> {
  const where = campaignWhere(days, campaignId)
  const query = `
    SELECT search_term_view.search_term,
           metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros
    FROM search_term_view
    WHERE ${where}
    ORDER BY metrics.impressions DESC`
  return runQuery<SearchTermRow>(query, r => ({
    term: r.searchTermView?.searchTerm ?? '',
    impressions: Number(r.metrics?.impressions ?? 0),
    clicks: Number(r.metrics?.clicks ?? 0),
    conversions: Number(r.metrics?.conversions ?? 0),
    costEuros: microsToEuros(r.metrics?.costMicros ?? 0),
  }))
}
