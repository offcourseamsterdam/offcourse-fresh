import { runAgenticLoop } from './agent-runtime'
import { CLAUDE_AGENT_MODEL } from '@/lib/ai/clients'
import { emitOpsEvent } from '@/lib/ops/events'

/**
 * The reasoning layer the Planning Optimizer route was missing: today, when
 * a same-day boat swap and a cross-day consolidation both touch the same
 * date, whichever is computed first in route.ts wins — not because it's the
 * better move, just because of array order. Two boat-swap candidates on the
 * same day don't even check each other. This module sits between "the math
 * found these candidates" (ops-review.ts / cross-day-consolidation.ts —
 * unchanged, still deterministic) and "actually draft an ask" (boat-swap-
 * drafter.ts / cross-day-move-drafter.ts — unchanged too): it decides WHICH
 * of several candidates competing for the same day(s) is worth pursuing.
 *
 * Still propose-only: the agent never drafts anything itself. Its only
 * output is a choice of which candidate ids the caller may go on to draft —
 * enforced again in code (resolveDayPlan's own dedupe pass), not trusted
 * blindly, exactly like every other Ghost agent's boundary.
 */

export interface DayOptimizerCandidate {
  id: string
  type: 'boat_swap' | 'cross_day'
  /** Every calendar date this candidate touches — a boat swap touches one
   *  day, a cross-day move touches two (the day it vacates and the day it
   *  joins). Two candidates that share ANY day compete for that day's one
   *  ask (see rulebook.ts / the route's existing "a day already mid-
   *  conversation never gets a second ask" rule). */
  daysTouched: string[]
  summary: string
  estSavingCents: number | null
}

export interface DayPlanDecision {
  allowed: boolean
  reasoning?: string
}

/** Union-find over shared days: two candidates in the same cluster compete
 *  for at least one day; candidates in different clusters never overlap. */
export function clusterCandidates(candidates: DayOptimizerCandidate[]): DayOptimizerCandidate[][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!
    parent.set(x, root)
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const dayOwner = new Map<string, string>() // day -> a candidate id already seen touching it
  for (const c of candidates) {
    if (!parent.has(c.id)) parent.set(c.id, c.id)
    for (const day of c.daysTouched) {
      const owner = dayOwner.get(day)
      if (owner) union(owner, c.id)
      else dayOwner.set(day, c.id)
    }
  }

  const groups = new Map<string, DayOptimizerCandidate[]>()
  for (const c of candidates) {
    const root = find(c.id)
    const list = groups.get(root) ?? []
    list.push(c)
    groups.set(root, list)
  }
  return [...groups.values()]
}

/** Deterministic fallback (and the safety net over the agent's own picks):
 *  greedily keep the highest-saving candidate first, skip anything that
 *  shares a day with something already kept. Order is stable (input order)
 *  for equal savings, so it's reproducible, not just "whatever sorted first". */
export function pickBySavingsFallback(cluster: DayOptimizerCandidate[]): { picks: string[]; skipped: string[] } {
  const sorted = [...cluster].sort((a, b) => (b.estSavingCents ?? -1) - (a.estSavingCents ?? -1))
  const claimedDays = new Set<string>()
  const picks: string[] = []
  const skipped: string[] = []
  for (const c of sorted) {
    if (c.daysTouched.some(d => claimedDays.has(d))) {
      skipped.push(c.id)
      continue
    }
    picks.push(c.id)
    for (const d of c.daysTouched) claimedDays.add(d)
  }
  return { picks, skipped }
}

const SUBMIT_DAY_PLAN = {
  name: 'submit_day_plan',
  description:
    'Finish by choosing which of the candidates to actually draft an ask for, and which to skip. At most one candidate per calendar date it touches — never pick two that share a day.',
  input_schema: {
    type: 'object' as const,
    properties: {
      picks: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] },
      },
      skipped: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] },
      },
      reasoning: { type: 'string', description: '1-3 sentences in English, for the ops team, on the overall choice.' },
    },
    required: ['picks', 'skipped', 'reasoning'],
  },
}

interface RunOpts {
  /** Re-validates one boat_swap candidate live against FareHarbor right now
   *  (candidates were computed moments earlier in the same request, but real
   *  availability can move under it) — the only tool this agent gets. */
  recheckBoatSwap: (candidateId: string) => Promise<{ bookable: boolean; note?: string }>
}

interface DayPlanResult {
  picks: { id: string; why: string }[]
  skipped: { id: string; why: string }[]
  reasoning: string
}

async function runDayOptimizerAgent(cluster: DayOptimizerCandidate[], opts: RunOpts): Promise<DayPlanResult | null> {
  const tools = [
    {
      name: 'recheck_boat_swap',
      description: "Re-validate a boat_swap candidate against FareHarbor right now, in case availability moved since it was first found. Only valid for candidates of type 'boat_swap'.",
      input_schema: {
        type: 'object' as const,
        properties: { candidate_id: { type: 'string' } },
        required: ['candidate_id'],
      },
      run: async (input: Record<string, unknown>) => {
        const id = String(input.candidate_id ?? '')
        if (!cluster.some(c => c.id === id && c.type === 'boat_swap')) throw new Error(`'${id}' is not a boat_swap candidate in this cluster`)
        return opts.recheckBoatSwap(id)
      },
    },
  ]

  const result = await runAgenticLoop({
    feature: 'ghost_agent_day_optimizer',
    model: CLAUDE_AGENT_MODEL,
    system:
      "You help Off Course Amsterdam's ops team decide which schedule-saving move to actually ask a guest about, when several compete for the same day(s). Contacting a guest has a real cost even when the move is free — it takes their attention, and asking about two different things the same day looks chaotic. Never pick more than one candidate for the same calendar date. Prefer the higher savings, but weigh it against how disruptive the move is to guests (a cross_day move changes the guest's date; a boat_swap keeps their date and time, only the boat changes, so it's normally the gentler ask). Only re-check a boat_swap if you have a real reason to doubt it's still bookable.",
    prompt: `Candidates competing for the same day(s):\n${JSON.stringify(cluster, null, 2)}\n\nDecide which to pursue and which to skip, then call submit_day_plan.`,
    tools,
    submitTools: [SUBMIT_DAY_PLAN],
    maxTurns: 3,
  })
  if (!result) return null
  const s = result.submission as unknown as DayPlanResult
  if (!Array.isArray(s.picks) || !Array.isArray(s.skipped)) return null
  return s
}

/**
 * The route's single entry point: given every LIVE candidate found across
 * same-day boat swaps and cross-day consolidation for the whole scan
 * horizon, decide which ones may actually be drafted.
 *
 * A cluster of exactly one candidate never touches the agent at all — there
 * is no decision to make, so it costs nothing beyond what the route already
 * did. Only a genuine conflict (2+ candidates sharing a day) invokes it.
 * If the agent errors or returns something malformed, falls back to the
 * deterministic highest-saving-first rule rather than drafting nothing.
 */
export async function resolveDayPlan(
  candidates: DayOptimizerCandidate[],
  opts: RunOpts,
): Promise<Map<string, DayPlanDecision>> {
  const decisions = new Map<string, DayPlanDecision>()
  const clusters = clusterCandidates(candidates)

  for (const cluster of clusters) {
    if (cluster.length <= 1) {
      for (const c of cluster) decisions.set(c.id, { allowed: true })
      continue
    }

    let plan: DayPlanResult | null = null
    try {
      plan = await runDayOptimizerAgent(cluster, opts)
    } catch (err) {
      console.error('[day-optimizer-agent] failed, falling back to highest-saving-first:', err instanceof Error ? err.message : err)
    }

    const byId = new Map(cluster.map(c => [c.id, c]))
    const reasoningById = new Map<string, string>()
    // null = no usable answer from the agent (error, or it only named ids that
    // weren't in the cluster) → deterministic fallback. An EMPTY list is a
    // real answer: the agent decided none of these is worth a guest's
    // attention, and that decision is respected, not overridden.
    let proposedPicks: string[] | null = null
    if (plan) {
      for (const p of plan.picks) reasoningById.set(p.id, p.why)
      for (const s of plan.skipped) reasoningById.set(s.id, s.why)
      const valid = plan.picks.map(p => p.id).filter(id => byId.has(id))
      proposedPicks = plan.picks.length > 0 && valid.length === 0 ? null : valid
    }
    const usedFallback = proposedPicks === null

    // Safety net: re-derive picks so an agent's own logic error (or a null
    // result) can never violate "at most one per shared day" or invent an
    // id that wasn't in the cluster. Runs even on a successful plan.
    const claimedDays = new Set<string>()
    const finalPicks = new Set<string>()
    const orderedCandidateIds = proposedPicks ?? pickBySavingsFallback(cluster).picks
    for (const id of orderedCandidateIds) {
      const c = byId.get(id)
      if (!c) continue
      if (c.daysTouched.some(d => claimedDays.has(d))) continue
      finalPicks.add(id)
      for (const d of c.daysTouched) claimedDays.add(d)
    }

    for (const c of cluster) {
      const allowed = finalPicks.has(c.id)
      const reasoning =
        reasoningById.get(c.id) ??
        (usedFallback ? 'Fell back to the highest-saving, non-conflicting pick (the reasoning agent was unavailable).' : undefined)
      decisions.set(c.id, { allowed, reasoning: allowed ? reasoning : reasoning ?? 'Another candidate for the same day was chosen instead.' })
    }

    // The audit trail: why this move and not that one. Only ever written for
    // a real conflict (a cluster of one never reaches here), and once a pick
    // is drafted its day is claimed, so the same conflict doesn't re-log on
    // every panel open.
    await emitOpsEvent({
      eventType: 'recommendation_created',
      actorType: usedFallback ? 'system' : 'agent',
      source: 'ghost/day-optimizer-agent',
      payload: {
        finding_type: 'day_plan',
        candidates: cluster.map(c => ({ id: c.id, type: c.type, days: c.daysTouched, est_saving_cents: c.estSavingCents })),
        picked: [...finalPicks],
        reasoning: plan?.reasoning ?? null,
        per_candidate: Object.fromEntries(cluster.map(c => [c.id, decisions.get(c.id)?.reasoning ?? null])),
        used_fallback: usedFallback,
      },
    })
  }

  return decisions
}
