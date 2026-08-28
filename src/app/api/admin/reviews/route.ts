import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { withRoute } from '@/lib/api/with-route'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

// Booking statuses that represent a real, valid booking for the review-to-booking
// ratio's denominator — excludes cancelled (never happened) and pending_payment
// (not yet a real booking).
const RATIO_BOOKING_STATUSES = ['confirmed', 'booked', 'rebooked']

/**
 * GET /api/admin/reviews — list all reviews + config + review-to-booking
 * ratio, each review carrying its `matchStatus` (Beer, 2026-08-22, plan
 * §3.2 — "not just conflicts, every review's state"): who the €5 bonus is
 * assigned to, that it needs a human pick between candidates, or that
 * nobody was mentioned/matched.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = createAdminClient()

  const [reviewsResult, configResult, bookingsCountResult, bonusesResult, conflictsResult] = await Promise.all([
    supabase
      .from('social_proof_reviews')
      .select('*')
      .order('publish_time', { ascending: false, nullsFirst: false }),
    supabase
      .from('google_reviews_config')
      .select('place_id, place_name, overall_rating, total_reviews, last_synced_at, tripadvisor_url, tripadvisor_rating, tripadvisor_total_reviews, withlocals_experience_short_id, recommendations_map_url, tripadvisor_review_url_shared, tripadvisor_review_url_private, review_sms_template, review_sms_auto_send, review_sms_enabled')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .in('status', RATIO_BOOKING_STATUSES),
    supabase.from('review_bonuses').select('review_id, staff_id, amount_cents, awarded_at, staff(name)'),
    supabase.from('review_bonus_conflicts').select('review_id, matched_name, candidate_staff_ids').is('resolved_at', null),
  ])

  if (reviewsResult.error) return apiError(reviewsResult.error.message)
  if (bonusesResult.error) return apiError(bonusesResult.error.message)
  if (conflictsResult.error) return apiError(conflictsResult.error.message)

  const assigneesByReview = new Map<string, { id: string; name: string; amountCents: number; awardedAt: string }[]>()
  for (const b of bonusesResult.data ?? []) {
    const staffRow = b.staff as { name: string } | null
    const list = assigneesByReview.get(b.review_id) ?? []
    list.push({ id: b.staff_id, name: staffRow?.name ?? 'Unknown', amountCents: b.amount_cents, awardedAt: b.awarded_at })
    assigneesByReview.set(b.review_id, list)
  }

  const conflictRows = conflictsResult.data ?? []
  const candidateIds = [...new Set(conflictRows.flatMap(c => c.candidate_staff_ids as string[]))]
  const staffNameById = new Map<string, string>()
  if (candidateIds.length > 0) {
    const { data: staffRows } = await supabase.from('staff').select('id, name').in('id', candidateIds)
    for (const s of staffRows ?? []) staffNameById.set(s.id, s.name)
  }
  const conflictByReview = new Map(conflictRows.map(c => [c.review_id, c]))

  const reviews = (reviewsResult.data ?? []).map(r => {
    const conflict = conflictByReview.get(r.id)
    const assignees = assigneesByReview.get(r.id) ?? []
    // A conflict pending confirmation always wins the display, even if
    // review-bonuses.ts already speculatively awarded one of its candidates
    // (the near-miss case) — that award is provisional until this resolves.
    const matchStatus = conflict
      ? {
          status: 'needs_confirmation' as const,
          matchedName: conflict.matched_name,
          candidates: (conflict.candidate_staff_ids as string[]).map(id => ({ id, name: staffNameById.get(id) ?? 'Unknown' })),
        }
      : assignees.length > 0
        ? { status: 'assigned' as const, assignees }
        : { status: 'no_match' as const }
    return { ...r, matchStatus }
  })

  return apiOk({
    reviews,
    config: configResult.data ?? null,
    bookingsCount: bookingsCountResult.count ?? 0,
  })
}

/**
 * PUT /api/admin/reviews — update place_id, review links, and SMS settings.
 * Creates the config row if it doesn't exist yet.
 */
export const PUT = withRoute(async (request: NextRequest) => {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const {
    place_id,
    tripadvisor_url,
    withlocals_experience_short_id,
    recommendations_map_url,
    tripadvisor_review_url_shared,
    tripadvisor_review_url_private,
    review_sms_template,
    review_sms_auto_send,
    review_sms_enabled,
  } = body

  if (!place_id || typeof place_id !== 'string') {
    return apiError('place_id is required', 400)
  }

  const supabase = createAdminClient()

  const { error } = await supabase
    .from('google_reviews_config')
    .upsert(
      {
        place_id: place_id.trim(),
        tripadvisor_url: typeof tripadvisor_url === 'string' ? tripadvisor_url.trim() || null : null,
        withlocals_experience_short_id: typeof withlocals_experience_short_id === 'string' ? withlocals_experience_short_id.trim() || null : null,
        recommendations_map_url: typeof recommendations_map_url === 'string' ? recommendations_map_url.trim() || null : null,
        tripadvisor_review_url_shared: typeof tripadvisor_review_url_shared === 'string' ? tripadvisor_review_url_shared.trim() || null : null,
        tripadvisor_review_url_private: typeof tripadvisor_review_url_private === 'string' ? tripadvisor_review_url_private.trim() || null : null,
        review_sms_template: typeof review_sms_template === 'string' ? review_sms_template.trim() || null : null,
        review_sms_auto_send: typeof review_sms_auto_send === 'boolean' ? review_sms_auto_send : false,
        review_sms_enabled: typeof review_sms_enabled === 'boolean' ? review_sms_enabled : true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'place_id' }
    )

  if (error) return apiError(error.message)
  return apiOk({ updated: true })
})
