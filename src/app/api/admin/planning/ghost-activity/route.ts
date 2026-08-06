import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

export interface GhostActivityAssignment {
  shift_id: string
  staff_id: string
  staff_name?: string
  reason?: string
  cost_cents?: number
}

export interface GhostActivityItem {
  id: string
  target_date: string
  assignments: GhostActivityAssignment[]
  reasoning: string | null
  applied_at: string | null
  created_at: string
  /** Of this item's assignments, how many have actually been DM'd to their
   *  captain — read live from shifts.notified_at, not the payload, so a
   *  confirm click (or a shift reassigned away since) shows up immediately. */
  notifiedCount: number
  totalCount: number
}

/**
 * GET /api/admin/planning/ghost-activity?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The AI actions feed behind the Planning page's "Ghost activity" panel —
 * captains the proactive scheduler (draftOrAssignSchedule, autonomy 'auto')
 * has actually assigned within the visible week, not proposals still awaiting
 * a human decision. Scoped to schedule_day + status 'executed' specifically;
 * this is the same shape /admin/ghost renders for a schedule_day card, just
 * filtered to "already happened" and to the dates this page has open.
 */
export async function GET(request: Request) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!from || !to) return apiError('from and to are required', 400)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('agent_proposals')
      .select('id, payload, reasoning, outcome, created_at')
      .eq('kind', 'schedule_day')
      .eq('status', 'executed')
      .gte('payload->>target_date', from)
      .lte('payload->>target_date', to)
      .order('created_at', { ascending: false })
    if (error) return apiError(error.message)

    const rows = (data ?? []).map(row => ({
      row,
      payload: (row.payload ?? {}) as { target_date?: string; assignments?: GhostActivityAssignment[] },
    }))
    const allShiftIds = Array.from(new Set(rows.flatMap(r => (r.payload.assignments ?? []).map(a => a.shift_id))))

    const notifiedByShiftId = new Map<string, boolean>()
    if (allShiftIds.length) {
      const { data: shifts } = await supabase.from('shifts').select('id, notified_at').in('id', allShiftIds)
      for (const s of shifts ?? []) notifiedByShiftId.set(s.id, !!s.notified_at)
    }

    const items: GhostActivityItem[] = rows.map(({ row, payload }) => {
      const outcome = row.outcome as { applied_at?: string } | null
      const assignments = payload.assignments ?? []
      return {
        id: row.id,
        target_date: payload.target_date ?? '',
        assignments,
        reasoning: row.reasoning,
        applied_at: outcome?.applied_at ?? null,
        created_at: row.created_at,
        notifiedCount: assignments.filter(a => notifiedByShiftId.get(a.shift_id)).length,
        totalCount: assignments.length,
      }
    })

    return apiOk(items)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
