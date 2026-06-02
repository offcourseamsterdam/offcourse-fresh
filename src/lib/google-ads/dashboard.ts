import type { CampaignRow, PerformanceRow } from './reporting'
import type { LinkedCampaign } from './listings'

// Pure presentation logic for the Google Ads admin dashboard. No I/O — every
// function here is a deterministic transform of data already fetched from Google,
// so it's fully unit-tested. The API route does the fetching and calls these.

// ── The money rule for the dashboard ────────────────────────────────────────────
// Because our Stripe webhook reports the NET ex-VAT booking value to Google, the
// `conversionsValue` Google returns per campaign IS our net revenue. So:
//     contribution (profit) = net revenue − ad spend
// Both numbers come straight from the campaign performance report.

export interface CampaignProfit {
  /** Net revenue − ad spend, in euros. The honest "did this campaign make money". */
  profitEuros: number
  costPerBookingEuros: number | null
  profitPerBookingEuros: number | null
}

export function campaignProfit(perf: {
  costEuros: number
  conversionValueEuros: number
  conversions: number
}): CampaignProfit {
  const profitEuros = perf.conversionValueEuros - perf.costEuros
  const hasBookings = perf.conversions > 0
  return {
    profitEuros,
    costPerBookingEuros: hasBookings ? perf.costEuros / perf.conversions : null,
    profitPerBookingEuros: hasBookings ? profitEuros / perf.conversions : null,
  }
}

// ── Plain-English verdict (the newbie-friendly "what do I do?") ──────────────────

export type VerdictTone = 'good' | 'bad' | 'learn' | 'neutral'
export interface Verdict {
  key: 'paused' | 'idle' | 'warming' | 'burning' | 'profitable' | 'losing'
  label: string
  tone: VerdictTone
}

export interface VerdictConfig {
  /** Below this spend with zero bookings = still "warming up", not yet alarming. */
  burnFloorEuros: number
}
export const DEFAULT_VERDICT_CONFIG: VerdictConfig = { burnFloorEuros: 25 }

/**
 * Turn raw numbers into a one-glance verdict a non-expert can act on.
 * Order matters: paused → not spending → (no bookings: warming/burning) →
 * (bookings: profitable/losing).
 */
export function verdict(
  input: { status: string; costEuros: number; conversions: number; profitEuros: number },
  cfg: VerdictConfig = DEFAULT_VERDICT_CONFIG,
): Verdict {
  if (input.status === 'PAUSED') return { key: 'paused', label: 'Paused', tone: 'neutral' }
  if (input.costEuros <= 0) return { key: 'idle', label: 'Not spending yet', tone: 'neutral' }

  if (input.conversions <= 0) {
    return input.costEuros >= cfg.burnFloorEuros
      ? { key: 'burning', label: 'Spending, no bookings', tone: 'bad' }
      : { key: 'warming', label: 'Warming up', tone: 'learn' }
  }

  return input.profitEuros > 0
    ? { key: 'profitable', label: 'Profitable', tone: 'good' }
    : { key: 'losing', label: 'Losing money', tone: 'bad' }
}

// ── Totals + hero stats ──────────────────────────────────────────────────────────

export interface PerformanceTotals {
  impressions: number
  clicks: number
  costEuros: number
  bookings: number
  revenueEuros: number
}

export function sumPerformance(rows: PerformanceRow[]): PerformanceTotals {
  return rows.reduce<PerformanceTotals>(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      costEuros: acc.costEuros + r.costEuros,
      bookings: acc.bookings + r.conversions,
      revenueEuros: acc.revenueEuros + r.conversionValueEuros,
    }),
    { impressions: 0, clicks: 0, costEuros: 0, bookings: 0, revenueEuros: 0 },
  )
}

export interface HeroStats {
  profitEuros: number
  bookings: number
  /** Net revenue ÷ ad spend. null when nothing was spent. */
  roas: number | null
  spendEuros: number
  revenueEuros: number
}

export function heroStats(rows: PerformanceRow[]): HeroStats {
  const t = sumPerformance(rows)
  return {
    profitEuros: t.revenueEuros - t.costEuros,
    bookings: t.bookings,
    roas: t.costEuros > 0 ? t.revenueEuros / t.costEuros : null,
    spendEuros: t.costEuros,
    revenueEuros: t.revenueEuros,
  }
}

// ── Funnel (Impressions → Clicks → Bookings) ─────────────────────────────────────
// Shape matches the existing <FunnelChart> component: { event, label, count, drop_off_rate }.
// drop_off_rate is the fraction LOST from the previous step (0–1).

export interface FunnelStep {
  event: string
  label: string
  count: number
  drop_off_rate: number
}

function dropOff(prev: number, curr: number): number {
  if (prev <= 0) return 0
  return Math.max(0, Math.min(1, (prev - curr) / prev))
}

export function funnelSteps(totals: { impressions: number; clicks: number; bookings: number }): FunnelStep[] {
  const bookings = Math.round(totals.bookings)
  return [
    { event: 'impressions', label: 'Impressions', count: totals.impressions, drop_off_rate: 0 },
    { event: 'clicks', label: 'Clicks', count: totals.clicks, drop_off_rate: dropOff(totals.impressions, totals.clicks) },
    { event: 'bookings', label: 'Bookings', count: bookings, drop_off_rate: dropOff(totals.clicks, bookings) },
  ]
}

// ── Merge: campaign settings (status/budget) + performance + listing → one row ───

export interface DashboardCampaign {
  id: string
  name: string
  status: string
  dailyBudgetEuros: number
  impressions: number
  clicks: number
  ctr: number
  avgCpcEuros: number
  costEuros: number
  bookings: number
  revenueEuros: number
  profitEuros: number
  costPerBookingEuros: number | null
  profitPerBookingEuros: number | null
  roas: number | null
  verdict: Verdict
  /** The marketing campaign this Google Ads campaign is connected to (the editable link). */
  marketing: { id: string; name: string; slug: string } | null
  /** The listing — DERIVED from the marketing campaign, read-only in the UI. */
  listing: { id: string; slug: string; title: string } | null
}

export function mergeCampaign(
  campaign: CampaignRow,
  perf: PerformanceRow | undefined,
  link: LinkedCampaign | null,
  cfg: VerdictConfig = DEFAULT_VERDICT_CONFIG,
): DashboardCampaign {
  const p = perf ?? {
    id: campaign.id,
    name: campaign.name,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    costEuros: 0,
    conversions: 0,
    conversionValueEuros: 0,
    avgCpcEuros: 0,
    costPerConversionEuros: null,
    roas: null,
  }
  const profit = campaignProfit(p)
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    dailyBudgetEuros: campaign.dailyBudgetEuros,
    impressions: p.impressions,
    clicks: p.clicks,
    ctr: p.ctr,
    avgCpcEuros: p.avgCpcEuros,
    costEuros: p.costEuros,
    bookings: p.conversions,
    revenueEuros: p.conversionValueEuros,
    profitEuros: profit.profitEuros,
    costPerBookingEuros: profit.costPerBookingEuros,
    profitPerBookingEuros: profit.profitPerBookingEuros,
    roas: p.roas,
    verdict: verdict(
      { status: campaign.status, costEuros: p.costEuros, conversions: p.conversions, profitEuros: profit.profitEuros },
      cfg,
    ),
    marketing: link ? { id: link.id, name: link.name, slug: link.slug } : null,
    listing: link?.listing ?? null,
  }
}

// ── Assemble the whole dashboard payload (one place, reused by route + demo) ──────

export interface DashboardPayload {
  hero: HeroStats
  funnel: FunnelStep[]
  campaigns: DashboardCampaign[]
}

export function buildDashboardPayload(
  campaigns: CampaignRow[],
  perfRows: PerformanceRow[],
  linkMap: Record<string, LinkedCampaign>,
  cfg: VerdictConfig = DEFAULT_VERDICT_CONFIG,
): DashboardPayload {
  const perfById = new Map(perfRows.map(p => [p.id, p]))
  const merged = campaigns.map(c => mergeCampaign(c, perfById.get(c.id), linkMap[c.id] ?? null, cfg))
  const totals = sumPerformance(perfRows)
  return {
    hero: heroStats(perfRows),
    funnel: funnelSteps({ impressions: totals.impressions, clicks: totals.clicks, bookings: totals.bookings }),
    campaigns: merged,
  }
}
