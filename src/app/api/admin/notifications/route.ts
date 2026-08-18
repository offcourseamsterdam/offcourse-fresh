import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/notifications
 *
 * The Slack notification feed behind Admin → Operations → Notifications.
 * Returns the most recent messages the app posted to Slack, plus a per-kind
 * count over the same window so the page can show "what fired this week"
 * without a second round-trip.
 *
 * Query params:
 *   days   — lookback window in days (default 7, max 90)
 *   kind   — filter to one notification kind (see lib/slack/notification-types.ts)
 *   limit  — max rows returned (default 100, max 500)
 *
 * Admin-only: these messages carry customer names, emails, phone numbers and
 * Stripe payment intent ids.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const params = request.nextUrl.searchParams
    const days = clamp(Number(params.get('days')) || 7, 1, 90)
    const limit = clamp(Number(params.get('limit')) || 100, 1, 500)
    const kind = params.get('kind')?.trim() || null

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const supabase = createAdminClient()

    let query = supabase
      .from('slack_notifications')
      .select('id, created_at, kind, destination, channel, text, status, error')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (kind) query = query.eq('kind', kind)

    const { data, error } = await query
    if (error) return apiError(error.message)

    // Per-kind counts across the whole window, independent of `kind` and `limit`
    // — the filter chips must show real totals, not "what happened to be on page 1".
    const { data: allInWindow, error: countError } = await supabase
      .from('slack_notifications')
      .select('kind, status')
      .gte('created_at', since)
      .limit(5000)
    if (countError) return apiError(countError.message)

    const counts: Record<string, number> = {}
    let failed = 0
    for (const row of allInWindow ?? []) {
      counts[row.kind] = (counts[row.kind] ?? 0) + 1
      if (row.status === 'failed') failed++
    }

    return apiOk({
      notifications: data ?? [],
      counts,
      total: allInWindow?.length ?? 0,
      failed,
      days,
      // True when the feed was cut off by `limit` — the UI says so rather than
      // implying these are all the messages there were.
      truncated: (data?.length ?? 0) >= limit,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}
