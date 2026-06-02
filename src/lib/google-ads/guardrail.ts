import type { PerformanceRow } from './reporting'

// The "responsible spend" safety net. A daily cron evaluates campaign performance
// against simple rules and pings Slack when something needs a human look. The
// rule evaluation is PURE (evaluateGuardrail / formatAlerts) so it's unit-tested;
// runGuardrail does the fetch + Slack I/O.

export interface GuardrailConfig {
  /** Alert if one campaign's spend over the window exceeds this. */
  spendCapEuros: number
  /** Alert if a campaign has spent ≥ this with ZERO bookings (money down the drain). */
  zeroBookingBurnEuros: number
  /** If true, actually PAUSE a campaign that crosses the hard-bleed line (not just alert). */
  autoPause?: boolean
  /**
   * Hard-bleed line: pause a campaign that has spent ≥ this with ZERO bookings.
   * Deliberately HIGHER than zeroBookingBurnEuros — the €50 figure is an early
   * Slack heads-up; this is the "the funnel is clearly broken, stop the bleed"
   * line. At €40/day, €200 ≈ 5 days / ~80 clicks with not a single booking.
   */
  autoPauseZeroBookingEuros?: number
}
export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  spendCapEuros: 1000,
  zeroBookingBurnEuros: 50,
  autoPause: false,
  autoPauseZeroBookingEuros: 200,
}

export interface GuardrailAlert {
  campaignId: string
  campaignName: string
  kind: 'overspend' | 'zero_booking_burn' | 'losing_money'
  message: string
}

/** Pure: turn performance rows into a list of things worth flagging. */
export function evaluateGuardrail(
  rows: PerformanceRow[],
  cfg: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): GuardrailAlert[] {
  const alerts: GuardrailAlert[] = []
  for (const r of rows) {
    const base = { campaignId: r.id, campaignName: r.name }
    const profit = r.conversionValueEuros - r.costEuros

    if (r.costEuros > cfg.spendCapEuros) {
      alerts.push({ ...base, kind: 'overspend', message: `spent €${r.costEuros.toFixed(0)} — over your €${cfg.spendCapEuros} cap` })
    }

    if (r.conversions <= 0 && r.costEuros >= cfg.zeroBookingBurnEuros) {
      alerts.push({ ...base, kind: 'zero_booking_burn', message: `€${r.costEuros.toFixed(0)} spent, 0 bookings — consider pausing` })
    } else if (r.conversions > 0 && profit < 0 && r.costEuros >= cfg.zeroBookingBurnEuros) {
      alerts.push({ ...base, kind: 'losing_money', message: `€${Math.abs(profit).toFixed(0)} in the red (spent €${r.costEuros.toFixed(0)}, made €${r.conversionValueEuros.toFixed(0)})` })
    }
  }
  return alerts
}

/** Pure: render alerts as a Slack message. Empty string when there's nothing to say. */
export function formatAlerts(alerts: GuardrailAlert[]): string {
  if (alerts.length === 0) return ''
  const lines = alerts.map(a => `• *${a.campaignName}* — ${a.message}`)
  return `🚤 *Google Ads guardrail* — ${alerts.length} thing(s) need a look:\n${lines.join('\n')}`
}

export interface PauseTarget {
  campaignId: string
  campaignName: string
  reason: string
}

/**
 * Pure: which campaigns have crossed the hard-bleed line and should be paused.
 * Strictly the clearest signal — real spend, zero bookings. We do NOT auto-pause
 * "losing money" cases (one early unlucky booking shouldn't trip it); those only
 * get a Slack heads-up so a human decides.
 */
export function selectAutoPause(
  rows: PerformanceRow[],
  cfg: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): PauseTarget[] {
  if (!cfg.autoPause) return []
  const line = cfg.autoPauseZeroBookingEuros ?? 200
  const targets: PauseTarget[] = []
  for (const r of rows) {
    if (r.conversions <= 0 && r.costEuros >= line) {
      targets.push({
        campaignId: r.id,
        campaignName: r.name,
        reason: `€${r.costEuros.toFixed(0)} spent, 0 bookings (≥ €${line} hard-bleed line)`,
      })
    }
  }
  return targets
}

/** Pure: Slack message announcing campaigns the guardrail auto-paused. */
export function formatPauses(paused: PauseTarget[]): string {
  if (paused.length === 0) return ''
  const lines = paused.map(p => `• *${p.campaignName}* — ${p.reason}`)
  return `🛑 *Google Ads guardrail AUTO-PAUSED ${paused.length} campaign(s)* to stop the bleed:\n${lines.join('\n')}\nRe-enable in the Google Ads UI once the funnel issue is fixed.`
}

/** I/O: fetch performance, evaluate, optionally auto-pause bleeders, and ping Slack. */
export async function runGuardrail(
  cfg: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
  days = 30,
): Promise<{ ok: boolean; alerts: GuardrailAlert[]; paused: PauseTarget[]; posted: boolean; error?: string }> {
  const { campaignPerformance } = await import('./reporting')
  const res = await campaignPerformance(days)
  if (!res.ok) return { ok: false, alerts: [], paused: [], posted: false, error: res.error }

  const rows = res.rows ?? []
  const alerts = evaluateGuardrail(rows, cfg)

  // Auto-pause the clear bleeders first, so the Slack message can report it.
  const pauseTargets = selectAutoPause(rows, cfg)
  const paused: PauseTarget[] = []
  if (pauseTargets.length > 0) {
    const { setCampaignStatus } = await import('./campaigns')
    for (const t of pauseTargets) {
      const r = await setCampaignStatus(t.campaignId, 'PAUSED')
      if (r.ok) paused.push(t)
    }
  }

  const message = [formatPauses(paused), formatAlerts(alerts)].filter(Boolean).join('\n\n')
  let posted = false
  if (message) {
    const { postSlackText } = await import('@/lib/slack/send-notification')
    await postSlackText(message)
    posted = true
  }
  return { ok: true, alerts, paused, posted }
}
