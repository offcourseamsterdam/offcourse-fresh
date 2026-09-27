import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { planMoves, decideMoves, finishMoves, type OptimizerItem } from '@/lib/ghost/move-planner'
import { OPTIMIZE_HORIZON_DAYS } from '@/lib/ghost/rulebook'
import { emitOpsEvent } from '@/lib/ops/events'
import { amsterdamToday } from '@/lib/utils'

export type { OptimizerItem } from '@/lib/ghost/move-planner'

/**
 * GET /api/admin/planning/optimizer — every schedule inefficiency the
 * Optimizer panel can find, all three kinds: same-day paid gaps and
 * same-day cross-boat merges (ops-review.ts's existing, already-correct
 * computeDayFacts — just never run on demand before, only once nightly for
 * tomorrow), plus cross-day consolidation. See
 * docs/plans/2026-08-23-cross-day-consolidation-optimizer.md.
 *
 * The scan range is ALWAYS today → today + OPTIMIZE_HORIZON_DAYS, computed
 * server-side — deliberately NOT a caller-supplied range (Beer, 2026-08-23:
 * "always from the point of view of today, not the past week"). Optimizing
 * a day that already happened is meaningless, and the Planning page can be
 * scrolled to any week — this route must never inherit that as its scan
 * window, or it starts reporting on cruises that have already sailed.
 *
 * Finding, deciding and drafting all live in src/lib/ghost/move-planner.ts,
 * shared with the nightly run and the new-booking trigger — this route only
 * scopes it to today → horizon and drafts every move the day plan allows
 * (time shifts, boat swaps and cross-day moves; when two compete for a day,
 * the day optimizer agent picks). Idempotent: a move whose booking already
 * has an open ask reuses it instead of drafting (and calling Claude) again.
 *
 * Same-day findings are persisted too (Beer, 2026-08-23: "whatever it
 * finds, it should store that information") — otherwise a gap or merge
 * opportunity is recomputed and silently discarded every time the panel
 * closes, with no record it was ever seen. Recorded as a `recommendation_
 * created` ops_event (actorType 'system', not 'agent' — no AI judgment is
 * involved here, it's plain math, same distinction the Ops Center draws
 * between AI-judgment and zero-judgment automated findings), deduped per
 * (date, boat, finding kind) so re-opening the panel doesn't re-log the
 * same still-true finding on every request.
 */

type AdminClient = ReturnType<typeof createAdminClient>

/** Has this exact (date, boat, finding kind) already been recorded? Ever —
 *  not time-windowed. A still-true finding re-appearing on every scan isn't
 *  new information; only a genuinely fresh finding_type/date/boat triple is. */
async function sameDayFindingAlreadyRecorded(
  supabase: AdminClient,
  date: string,
  boat: string,
  findingType: 'same_day_gap' | 'same_day_merge',
): Promise<boolean> {
  const { data } = await supabase
    .from('ops_events')
    .select('id')
    .eq('event_type', 'recommendation_created')
    .eq('source', 'admin/planning/optimizer')
    .eq('payload->>date', date)
    .eq('payload->>boat', boat)
    .eq('payload->>finding_type', findingType)
    .limit(1)
    .maybeSingle()
  return !!data
}

async function recordSameDayFinding(supabase: AdminClient, item: OptimizerItem): Promise<void> {
  if (item.kind !== 'same_day_gap' && item.kind !== 'same_day_merge') return
  if (await sameDayFindingAlreadyRecorded(supabase, item.date, item.boat, item.kind)) return
  await emitOpsEvent({
    eventType: 'recommendation_created',
    actorType: 'system',
    source: 'admin/planning/optimizer',
    payload: {
      finding_type: item.kind,
      date: item.date,
      boat: item.boat,
      est_saving_cents: item.estSavingCents,
      summary: item.summary,
    },
  })
}

export async function GET(_request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    // Deliberately not read from the query string — see the file doc comment.
    const from = amsterdamToday()
    const to = amsterdamToday(OPTIMIZE_HORIZON_DAYS)

    const supabase = createAdminClient()
    const { gapItems, prepared } = await planMoves(supabase, { from, to })
    const plan = await decideMoves(supabase, prepared)
    const { items: moveItems } = await finishMoves(prepared, plan, {
      source: 'admin/planning/optimizer',
      reasoningSuffix: 'found when the Optimizer panel was opened',
    })
    const items = [...gapItems, ...moveItems]

    // Persist same-day findings — see the file doc comment on why.
    await Promise.all(items.map(item => recordSameDayFinding(supabase, item)))

    return apiOk({ items, from, to })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
