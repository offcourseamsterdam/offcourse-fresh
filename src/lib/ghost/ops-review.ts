import { runAgenticLoop } from './agent-runtime'
import { buildGhostTools } from './tools'
import { OPS_REVIEW_SYSTEM, OPS_REVIEW_INSTRUCTIONS } from './rulebook'
import { CLAUDE_DRAFTER_MODEL } from '@/lib/ai/clients'
import { createAdminClient } from '@/lib/supabase/admin'
import { deriveOperationalProfile } from '@/lib/ops/profile'
import { emitOpsEvent } from '@/lib/ops/events'
import { shiftCostCents } from '@/lib/scheduling/shift-cost'
import { amsterdamToday, formatAmsterdamTime } from '@/lib/utils'

/**
 * The operations optimizer — the first agent of the AI Operations Engine
 * (docs/features/ai-operations-engine.md). Every evening it reads tomorrow's
 * plan (shifts, captains, availability, blocking maintenance) and proposes
 * the most profitable improvements: close a paid gap, consolidate onto one
 * boat, fix the staffing level.
 *
 * Division of labour, deliberately strict:
 *   - TypeScript computes the FACTS (gaps, idle minutes, € idle cost, merge
 *     candidates, staffing) — deterministic, unit-tested, never hallucinated.
 *   - Claude JUDGES the facts and writes the explainable recommendation —
 *     which gap is worth closing, what to tell the planner, what to leave be.
 *
 * Hard rules live here, not in the prompt: private cruises never merge onto
 * another party's departure (deriveOperationalProfile.allowMerge — nothing
 * in this file combines two parties' guest counts onto one departure at all,
 * that's cross-day-consolidation.ts's job, shared-only). What THIS file's
 * mergeCandidates pool actually checks is whether a shift's own departure
 * could run on a DIFFERENT boat instead — a boat swap, gated on allowBoatSwap
 * (Beer, 2026-08-23: "private cruises can definitely swap Diana for
 * Curaçao" — true for both categories today, since a private party doesn't
 * care which specific boat, just capacity and no overlap); savings cents are
 * precomputed per gap/swap so every € the Ghost cites traces back to a number
 * in this file. Shadow-only: status 'propose' on the autonomy ladder.
 */

// ── Deterministic facts ──────────────────────────────────────────────────────

export interface OpsReviewShift {
  id: string
  boat: string
  boatCapacity: number | null
  /** ISO timestamps */
  startAt: string
  endAt: string
  status: string
  staffId: string | null
  staffName: string | null
  /** Rate of the assigned captain (cents/hour), if any. */
  hourlyRateCents: number | null
  category: string | null
  guestCount: number | null
  listingTitle: string | null
  /** Admin-set "never propose a move on this one" (Beer, 2026-08-23: anniversary/birthday bookings) — the representative booking's flag. */
  noRescheduleAsk: boolean
}

export interface BoatGap {
  boat: string
  afterShiftId: string
  beforeShiftId: string
  minutes: number
  fromTime: string
  toTime: string
  /** Raw ISO instants for the same span as fromTime/toTime. fromTime/toTime
   *  are Amsterdam-local display strings ("14:30"); the Planning grid overlay
   *  positions its ghost outline with leftPx(), which needs the instant. */
  fromAt: string
  toAt: string
  /** minutes × the earlier shift's captain rate — null when unassigned. */
  estIdleCostCents: number | null
}

export interface MergeCandidate {
  shiftId: string
  date: string
  cruise: string | null
  guests: number | null
  fromBoat: string
  toBoat: string
  /** Why this is even a candidate (fits capacity, no overlap, flexible). */
  note: string
  /** The boat swap's saving: fromBoat's shift disappears entirely for the day
   *  ("one boat, one day, one shift" — the shift being moved is the only one
   *  fromBoat has). null when fromBoat's shift has no captain assigned yet. */
  estSavingCents: number | null
}

export interface DayFacts {
  date: string
  totalShifts: number
  openShifts: number
  boatsInUse: string[]
  gaps: BoatGap[]
  totalIdleMinutes: number
  totalEstIdleCostCents: number
  mergeCandidates: MergeCandidate[]
  /** Boats with shifts tomorrow that also have an open blocking maintenance task. */
  maintenanceConflicts: { boat: string; task: string }[]
  distinctCaptains: number
  /** Captains marked available tomorrow but not on any shift. */
  spareCaptains: string[]
  /** Shifts whose profile forbids a boat swap — excluded from mergeCandidates.
   *  Empty today (both categories allow it); kept for a future profile that
   *  doesn't. */
  nonMergeableShiftIds: string[]
}

function minutesBetween(aIso: string, bIso: string): number {
  return Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 60_000)
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd)
}

export function computeDayFacts(
  date: string,
  shifts: OpsReviewShift[],
  availableStaff: { id: string; name: string }[],
  blockingTasks: { boat: string; title: string }[],
): DayFacts {
  const byBoat = new Map<string, OpsReviewShift[]>()
  for (const s of shifts) {
    const list = byBoat.get(s.boat) ?? []
    list.push(s)
    byBoat.set(s.boat, list)
  }
  for (const list of byBoat.values()) {
    list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }

  // Gaps between consecutive sailings per boat — the paid-waiting facts.
  const gaps: BoatGap[] = []
  for (const [boat, list] of byBoat) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]
      const next = list[i]
      const minutes = minutesBetween(prev.endAt, next.startAt)
      if (minutes <= 0) continue
      gaps.push({
        boat,
        afterShiftId: prev.id,
        beforeShiftId: next.id,
        minutes,
        fromTime: formatAmsterdamTime(prev.endAt),
        toTime: formatAmsterdamTime(next.startAt),
        fromAt: prev.endAt,
        toAt: next.startAt,
        estIdleCostCents:
          prev.hourlyRateCents != null ? Math.round((minutes / 60) * prev.hourlyRateCents) : null,
      })
    }
  }

  // Boat-swap candidates: a shift whose profile allows swapping boats could
  // run on a DIFFERENT in-use boat's day instead — no time overlap there,
  // guests within capacity. This never combines two parties onto one
  // departure (that's allowMerge's job, enforced in cross-day-consolidation.ts
  // instead) — it only asks "could this shift's own departure run on a
  // different boat", which both categories are cleared for (Beer, 2026-08-23:
  // a private party doesn't care which specific boat, just that it fits) —
  // gated on allowBoatSwap, not the broader 'kind' (a prompt-only rule would
  // just be a request).
  const mergeCandidates: MergeCandidate[] = []
  const nonMergeableShiftIds: string[] = []
  for (const s of shifts) {
    if (!deriveOperationalProfile(s.category).allowBoatSwap || s.noRescheduleAsk) {
      nonMergeableShiftIds.push(s.id)
      continue
    }
    for (const [otherBoat, otherShifts] of byBoat) {
      if (otherBoat === s.boat) continue
      const capacity = otherShifts[0]?.boatCapacity
      if (capacity != null && s.guestCount != null && s.guestCount > capacity) continue
      const clashes = otherShifts.some(o => overlaps(s.startAt, s.endAt, o.startAt, o.endAt))
      if (clashes) continue
      mergeCandidates.push({
        shiftId: s.id,
        date,
        cruise: s.listingTitle,
        guests: s.guestCount,
        fromBoat: s.boat,
        toBoat: otherBoat,
        note: `fits ${otherBoat}'s schedule (no overlap${capacity != null ? `, ≤ ${capacity} seats` : ''})`,
        // "one boat, one day, one shift" — s is fromBoat's ONLY shift that
        // day, so swapping it onto otherBoat frees fromBoat's captain entirely.
        estSavingCents: s.hourlyRateCents != null ? shiftCostCents(s.hourlyRateCents, s.startAt, s.endAt) : null,
      })
    }
  }

  const boatsInUse = [...byBoat.keys()]
  const maintenanceConflicts = blockingTasks
    .filter(t => byBoat.has(t.boat))
    .map(t => ({ boat: t.boat, task: t.title }))

  const staffedIds = new Set(shifts.map(s => s.staffId).filter(Boolean))
  const spareCaptains = availableStaff.filter(a => !staffedIds.has(a.id)).map(a => a.name)

  const totalIdleMinutes = gaps.reduce((sum, g) => sum + g.minutes, 0)
  const totalEstIdleCostCents = gaps.reduce((sum, g) => sum + (g.estIdleCostCents ?? 0), 0)

  return {
    date,
    totalShifts: shifts.length,
    openShifts: shifts.filter(s => s.status === 'open').length,
    boatsInUse,
    gaps,
    totalIdleMinutes,
    totalEstIdleCostCents,
    mergeCandidates,
    maintenanceConflicts,
    distinctCaptains: staffedIds.size,
    spareCaptains,
    nonMergeableShiftIds,
  }
}

/** Render the facts as the compact block the agent reasons over. */
export function renderFacts(facts: DayFacts, shifts: OpsReviewShift[]): string {
  const shiftLines = shifts
    .map(s => {
      const profile = deriveOperationalProfile(s.category).kind
      return `- shift ${s.id} · ${s.boat} · ${formatAmsterdamTime(s.startAt)}–${formatAmsterdamTime(s.endAt)} · ${s.listingTitle ?? 'manual'} · ${s.guestCount ?? '?'} guests · ${s.category ?? '?'} (${profile}) · captain: ${s.staffName ?? 'OPEN'}`
    })
    .join('\n')

  const gapLines = facts.gaps.length
    ? facts.gaps
        .map(
          g =>
            `- ${g.boat}: ${g.minutes} min idle ${g.fromTime}–${g.toTime}${g.estIdleCostCents != null ? ` ≈ €${(g.estIdleCostCents / 100).toFixed(2)} paid waiting` : ' (captain unassigned)'}`,
        )
        .join('\n')
    : '- none'

  const mergeLines = facts.mergeCandidates.length
    ? facts.mergeCandidates
        .map(
          m =>
            `- shift ${m.shiftId} (${m.cruise ?? '?'}, ${m.guests ?? '?'} guests) could move ${m.fromBoat} → ${m.toBoat}: ${m.note}${m.estSavingCents != null ? ` ≈ €${(m.estSavingCents / 100).toFixed(2)} saved (frees ${m.fromBoat}'s captain for the day)` : ' (captain unassigned)'}`,
        )
        .join('\n')
    : '- none (every cross-boat move is blocked by overlap or capacity)'

  const maintLines = facts.maintenanceConflicts.length
    ? facts.maintenanceConflicts.map(c => `- ${c.boat} has an OPEN BLOCKING maintenance task: "${c.task}"`).join('\n')
    : '- none'

  return `SHIFTS (${facts.date})
${shiftLines || '- none'}

GAPS BETWEEN SAILINGS (idle cost assumes the captain stays on the clock)
${gapLines}

MERGE CANDIDATES (computed: only flexible shared cruises, capacity + overlap already checked)
${mergeLines}

MAINTENANCE CONFLICTS
${maintLines}

STAFFING
- boats in use: ${facts.boatsInUse.join(', ') || 'none'} (${facts.boatsInUse.length})
- captains on the water: ${facts.distinctCaptains} · open shifts without captain: ${facts.openShifts}
- available but unscheduled captains: ${facts.spareCaptains.join(', ') || 'none'}
- total idle: ${facts.totalIdleMinutes} min ≈ €${(facts.totalEstIdleCostCents / 100).toFixed(2)}`
}

// ── The agent run ────────────────────────────────────────────────────────────

const SUBMIT_OPS_REVIEW = {
  name: 'submit_ops_review',
  description:
    'Submit your final operations review for the day. Every recommendation must be traceable to the FACTS numbers.',
  input_schema: {
    type: 'object' as const,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['consolidate_gap', 'consolidate_boat', 'staffing_level', 'maintenance_conflict', 'none'],
            },
            summary: { type: 'string', description: 'One line: the concrete action to take' },
            why: {
              type: 'string',
              description: 'The explainable reasoning — cite the FACTS numbers (minutes, €, capacity)',
            },
            est_saving_cents: {
              type: 'number',
              description: 'Estimated saving in cents, derived from FACTS (0 if none)',
            },
            guest_impact: { type: 'string', enum: ['none', 'low', 'high'] },
            requires_guest_contact: { type: 'boolean' },
            confidence: { type: 'number', description: '0–1' },
          },
          required: [
            'type',
            'summary',
            'why',
            'est_saving_cents',
            'guest_impact',
            'requires_guest_contact',
            'confidence',
          ],
        },
      },
      summary: { type: 'string', description: '1–2 sentences: the day in one operational verdict' },
    },
    required: ['recommendations', 'summary'],
  },
}

export interface OpsRecommendation {
  type: 'consolidate_gap' | 'consolidate_boat' | 'staffing_level' | 'maintenance_conflict' | 'none'
  summary: string
  why: string
  est_saving_cents: number
  guest_impact: 'none' | 'low' | 'high'
  requires_guest_contact: boolean
  confidence: number
}

const REC_TYPES = new Set(['consolidate_gap', 'consolidate_boat', 'staffing_level', 'maintenance_conflict', 'none'])
const IMPACTS = new Set(['none', 'low', 'high'])

/** Keep only well-formed recommendations — a malformed one is dropped, not guessed at. */
export function validateRecommendations(raw: unknown): OpsRecommendation[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is OpsRecommendation => {
    if (typeof r !== 'object' || r === null) return false
    const rec = r as Record<string, unknown>
    return (
      typeof rec.type === 'string' &&
      REC_TYPES.has(rec.type) &&
      typeof rec.summary === 'string' &&
      typeof rec.why === 'string' &&
      typeof rec.est_saving_cents === 'number' &&
      typeof rec.guest_impact === 'string' &&
      IMPACTS.has(rec.guest_impact) &&
      typeof rec.requires_guest_contact === 'boolean' &&
      typeof rec.confidence === 'number'
    )
  })
}

type AdminClient = ReturnType<typeof createAdminClient>

async function proposalExists(supabase: AdminClient, targetDate: string): Promise<boolean> {
  const { data } = await supabase
    .from('agent_proposals')
    .select('id')
    .eq('kind', 'ops_review')
    .eq('payload->>target_date', targetDate)
    .limit(1)
  return (data?.length ?? 0) > 0
}

export async function draftOpsReview(): Promise<'drafted' | 'skipped'> {
  try {
    const supabase = createAdminClient()
    const tomorrow = amsterdamToday(1)

    if (await proposalExists(supabase, tomorrow)) return 'skipped'

    const [shiftsRes, availRes, maintRes] = await Promise.all([
      supabase
        .from('shifts')
        .select(
          'id, start_at, end_at, status, staff_id, staff(name, hourly_rate_cents), boats(name, max_capacity), bookings(listing_title, guest_count, category, no_reschedule_ask)',
        )
        .eq('date', tomorrow)
        .in('status', ['open', 'assigned', 'confirmed'])
        .order('start_at'),
      supabase
        .from('staff_availability')
        .select('staff_id, status, staff(name, is_active)')
        .eq('date', tomorrow)
        .eq('status', 'available'),
      supabase
        .from('maintenance_tasks')
        .select('title, boats(name)')
        .eq('priority', 'essential')
        .in('status', ['open', 'in_progress']),
    ])

    const shifts: OpsReviewShift[] = (shiftsRes.data ?? []).map(s => {
      const staff = s.staff as { name?: string; hourly_rate_cents?: number } | null
      const boat = s.boats as { name?: string; max_capacity?: number | null } | null
      const booking = s.bookings as {
        listing_title?: string | null
        guest_count?: number | null
        category?: string | null
        no_reschedule_ask?: boolean | null
      } | null
      return {
        id: s.id,
        boat: boat?.name ?? '?',
        boatCapacity: boat?.max_capacity ?? null,
        startAt: s.start_at,
        endAt: s.end_at,
        status: s.status,
        staffId: s.staff_id,
        staffName: staff?.name ?? null,
        hourlyRateCents: staff?.hourly_rate_cents ?? null,
        category: booking?.category ?? null,
        guestCount: booking?.guest_count ?? null,
        listingTitle: booking?.listing_title ?? null,
        noRescheduleAsk: booking?.no_reschedule_ask ?? false,
      }
    })
    if (!shifts.length) return 'skipped' // nothing on the water = no review, no cost

    const availableStaff = (availRes.data ?? [])
      .filter(a => (a.staff as { is_active?: boolean } | null)?.is_active !== false)
      .map(a => ({ id: a.staff_id, name: (a.staff as { name?: string } | null)?.name ?? '?' }))

    const blockingTasks = (maintRes.data ?? [])
      .map(t => ({ boat: (t.boats as { name?: string } | null)?.name ?? '', title: t.title }))
      .filter(t => t.boat)

    const facts = computeDayFacts(tomorrow, shifts, availableStaff, blockingTasks)
    const factsBlock = renderFacts(facts, shifts)

    const result = await runAgenticLoop({
      feature: 'ghost_ops_review',
      system: OPS_REVIEW_SYSTEM,
      tools: buildGhostTools().filter(t => ['get_schedule', 'search_availability'].includes(t.name)),
      submitTools: [SUBMIT_OPS_REVIEW],
      prompt: `Review tomorrow's (${tomorrow}) operational plan. This is a SHADOW review — nothing executes; the planner reads your recommendations on the Ghost page.

${factsBlock}

${OPS_REVIEW_INSTRUCTIONS}`,
    })
    if (!result) return 'skipped'

    const recommendations = validateRecommendations(
      (result.submission as { recommendations?: unknown }).recommendations,
    )
    if (!recommendations.length) return 'skipped'
    const summary =
      typeof (result.submission as { summary?: unknown }).summary === 'string'
        ? ((result.submission as { summary: string }).summary)
        : null

    const { data: inserted } = await supabase
      .from('agent_proposals')
      .insert({
        kind: 'ops_review',
        payload: JSON.parse(
          JSON.stringify({
            target_date: tomorrow,
            recommendations,
            facts: {
              boats_in_use: facts.boatsInUse,
              total_idle_minutes: facts.totalIdleMinutes,
              total_est_idle_cost_cents: facts.totalEstIdleCostCents,
              open_shifts: facts.openShifts,
              merge_candidates: facts.mergeCandidates.length,
              maintenance_conflicts: facts.maintenanceConflicts.length,
            },
            steps: result.steps,
          }),
        ),
        reasoning: summary,
        status: 'shadow',
        model: CLAUDE_DRAFTER_MODEL,
      })
      .select('id')
      .single()

    await emitOpsEvent({
      eventType: 'recommendation_created',
      actorType: 'agent',
      actorId: 'operations',
      proposalId: inserted?.id ?? null,
      source: 'ghost/ops-review',
      payload: {
        target_date: tomorrow,
        recommendation_count: recommendations.length,
        top_type: recommendations[0]?.type,
        total_est_saving_cents: recommendations.reduce((s, r) => s + r.est_saving_cents, 0),
      },
    })

    return 'drafted'
  } catch (err) {
    console.error('[ghost/ops_review] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}
