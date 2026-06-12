import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { alertCronFailure } from '@/lib/cron/alert'
import { runGuardrail, DEFAULT_GUARDRAIL_CONFIG } from '@/lib/google-ads/guardrail'

/**
 * GET /api/cron/ads-guardrail
 * Vercel Cron: daily. The "responsible spend" safety net — checks each campaign's
 * last-30-day performance, pings Slack if anything is over the spend cap or burning
 * money with no bookings, and AUTO-PAUSES any campaign that crosses the hard-bleed
 * line (real spend, zero bookings). No-ops quietly when Google Ads isn't configured.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const result = await runGuardrail({ ...DEFAULT_GUARDRAIL_CONFIG, autoPause: true })
  // "not configured" is the intentional no-op on environments without Google Ads
  // credentials — only real failures should page Slack.
  if (!result.ok && result.error && !result.error.includes('not configured')) {
    await alertCronFailure('ads-guardrail', result.error)
  }
  return NextResponse.json({
    ok: result.ok,
    alerts: result.alerts.length,
    paused: result.paused.map(p => p.campaignName),
    posted: result.posted,
    error: result.error,
  })
}
