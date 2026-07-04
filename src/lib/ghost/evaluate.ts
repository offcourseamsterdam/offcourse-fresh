import { createAdminClient } from '@/lib/supabase/admin'
import { emitOpsEvent } from '@/lib/ops/events'
import { amsterdamToday } from '@/lib/utils'

/**
 * The evaluation sweep — how the Ghost learns from proposals nobody approved.
 *
 * When a proposal's target date passes while it's still 'shadow', the moment
 * for action is gone — but the LESSON isn't. This sweep compares what the
 * Ghost suggested against what actually happened in the database:
 *
 *   schedule_day  → per shift: proposed captain vs the captain the human
 *                   actually assigned → an agreement score. Recent scores are
 *                   injected into future schedule drafts ("here's how the
 *                   human really assigns — imitate"), closing the loop the
 *                   same way the inbox agent learns from your real replies.
 *   ops_review    → did the flagged problems get resolved anyway? (open
 *                   shifts filled, boats consolidated)
 *   catering_upsell → never sent before the cruise → recorded as expired.
 *
 * Everything ends 'expired' with the lesson in `outcome` — the proposal
 * board stays clean, the learning data stays forever.
 */

export interface AgreementDetail {
  shift_id: string
  proposed_name: string | null
  actual_name: string | null
  matched: boolean
}

export interface Agreement {
  matched: number
  total: number
  details: AgreementDetail[]
}

/** Pure: proposed assignments vs the shifts' final reality. */
export function scheduleAgreement(
  assignments: { shift_id?: string; staff_id?: string; staff_name?: string }[],
  actualByShiftId: Map<string, { staff_id: string | null; staff_name: string | null }>,
): Agreement {
  const details: AgreementDetail[] = []
  for (const a of assignments) {
    if (!a.shift_id) continue
    const actual = actualByShiftId.get(a.shift_id)
    const matched = !!actual && !!a.staff_id && actual.staff_id === a.staff_id
    details.push({
      shift_id: a.shift_id,
      proposed_name: a.staff_name ?? null,
      actual_name: actual?.staff_name ?? null,
      matched,
    })
  }
  return { matched: details.filter(d => d.matched).length, total: details.length, details }
}

type AdminClient = ReturnType<typeof createAdminClient>

const EVALUATED_KINDS = ['schedule_day', 'ops_review', 'catering_upsell'] as const

export async function evaluateExpiredProposals(): Promise<number> {
  try {
    const supabase = createAdminClient()
    const today = amsterdamToday()

    const { data: proposals } = await supabase
      .from('agent_proposals')
      .select('id, kind, payload')
      .in('kind', [...EVALUATED_KINDS])
      .eq('status', 'shadow')
      .lt('payload->>target_date', today)
      .limit(50)
    if (!proposals?.length) return 0

    let evaluated = 0
    for (const p of proposals) {
      const payload = (p.payload ?? {}) as Record<string, unknown>
      const targetDate = typeof payload.target_date === 'string' ? payload.target_date : null
      if (!targetDate) continue

      let outcome: Record<string, unknown> | null = null
      if (p.kind === 'schedule_day') {
        outcome = await evaluateSchedule(supabase, payload)
      } else if (p.kind === 'ops_review') {
        outcome = await evaluateOpsReview(supabase, targetDate, payload)
      } else if (p.kind === 'catering_upsell') {
        outcome = { expired_unsent: true }
      }
      if (!outcome) continue

      await supabase
        .from('agent_proposals')
        .update({
          status: 'expired',
          outcome: JSON.parse(JSON.stringify({ ...outcome, evaluated_at: new Date().toISOString() })),
        })
        .eq('id', p.id)
      await emitOpsEvent({
        eventType: 'recommendation_rejected', // expired-unapproved: the human implicitly chose differently
        actorType: 'system',
        proposalId: p.id,
        source: 'ghost/evaluate',
        payload: { kind: p.kind, target_date: targetDate },
      })
      evaluated++
    }
    return evaluated
  } catch (err) {
    console.error('[ghost/evaluate] failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

async function evaluateSchedule(
  supabase: AdminClient,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const assignments = Array.isArray(payload.assignments)
    ? (payload.assignments as { shift_id?: string; staff_id?: string; staff_name?: string }[])
    : []
  const shiftIds = assignments.map(a => a.shift_id).filter((s): s is string => !!s)
  if (!shiftIds.length) return { agreement: { matched: 0, total: 0, details: [] } }

  const { data: shifts } = await supabase
    .from('shifts')
    .select('id, staff_id, staff(name)')
    .in('id', shiftIds)
  const actualByShiftId = new Map(
    (shifts ?? []).map(s => [
      s.id,
      { staff_id: s.staff_id, staff_name: (s.staff as { name?: string } | null)?.name ?? null },
    ]),
  )
  return { agreement: scheduleAgreement(assignments, actualByShiftId) }
}

async function evaluateOpsReview(
  supabase: AdminClient,
  targetDate: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data: shifts } = await supabase
    .from('shifts')
    .select('id, status, staff_id, boats(name)')
    .eq('date', targetDate)
    .in('status', ['open', 'assigned', 'confirmed', 'completed'])
  const finalOpen = (shifts ?? []).filter(s => s.status === 'open').length
  const finalBoats = new Set((shifts ?? []).map(s => (s.boats as { name?: string } | null)?.name).filter(Boolean))

  const facts = (payload.facts ?? {}) as { open_shifts?: number; boats_in_use?: string[] }
  return {
    evaluation: {
      proposed_open_shifts: facts.open_shifts ?? null,
      final_open_shifts: finalOpen,
      proposed_boats_in_use: facts.boats_in_use?.length ?? null,
      final_boats_in_use: finalBoats.size,
      staffing_resolved: finalOpen === 0,
    },
  }
}

/**
 * The learning injection for the schedule drafter: recent evaluated (or
 * applied) drafts vs what the human actually did, rendered as prompt lines.
 * Empty string when there's no history yet.
 */
export async function recentScheduleLessons(supabase: AdminClient, limit = 5): Promise<string> {
  const { data } = await supabase
    .from('agent_proposals')
    .select('payload, outcome')
    .eq('kind', 'schedule_day')
    .not('outcome', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  const lines: string[] = []
  for (const p of data ?? []) {
    const targetDate = (p.payload as { target_date?: string } | null)?.target_date ?? '?'
    const agreement = (p.outcome as { agreement?: Agreement } | null)?.agreement
    if (!agreement?.total) continue
    const mismatches = agreement.details
      .filter(d => !d.matched)
      .map(d => `you proposed ${d.proposed_name ?? '?'}, human chose ${d.actual_name ?? 'nobody'}`)
    lines.push(
      `- ${targetDate}: ${agreement.matched}/${agreement.total} matched${mismatches.length ? ` (${mismatches.join('; ')})` : ''}`,
    )
  }
  if (!lines.length) return ''
  return `HOW THE HUMAN ACTUALLY ASSIGNED RECENTLY (your drafts vs reality — imitate their choices)\n${lines.join('\n')}\n\n`
}
