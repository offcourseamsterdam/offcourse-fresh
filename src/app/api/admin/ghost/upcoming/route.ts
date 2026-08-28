import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { amsterdamToday } from '@/lib/utils'
import { getNextAvailabilityRequestDate } from '@/lib/scheduling/availability-request'
import { getNextScheduleDigestAt } from '@/lib/scheduling/schedule-digest'

const AWAITING_REVIEW_KINDS = ['schedule_day', 'guest_move_request', 'catering_order', 'catering_upsell']

/**
 * GET /admin/ghost's "Upcoming" section — the director's-view answer to
 * "what's scheduled to happen, and what's outstanding right now." Distinct
 * from the page's existing flat proposal list (ordered by creation time,
 * mixing past/present/future) — this is forward-looking only.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()

    const [openChatsRes, proposalsRes] = await Promise.all([
      supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      // Shadow proposals are normally short-lived (claimed or executed within
      // a day or two), but nothing enforces that — capped + newest-first as a
      // safety bound against an unbounded scan on this 15s poll.
      supabase
        .from('agent_proposals')
        .select('id, payload')
        .eq('status', 'shadow')
        .in('kind', AWAITING_REVIEW_KINDS)
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    if (openChatsRes.error) return apiError(openChatsRes.error.message)
    if (proposalsRes.error) return apiError(proposalsRes.error.message)

    const today = amsterdamToday()
    const awaitingReviewCount = (proposalsRes.data ?? []).filter(p => {
      const targetDate = (p.payload as Record<string, unknown> | null)?.target_date
      return typeof targetDate === 'string' && targetDate >= today
    }).length

    return apiOk({
      openChatsCount: openChatsRes.count ?? 0,
      awaitingReviewCount,
      nextScheduleDigestAt: getNextScheduleDigestAt(),
      nextAvailabilityRequest: getNextAvailabilityRequestDate(),
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load upcoming')
  }
}
