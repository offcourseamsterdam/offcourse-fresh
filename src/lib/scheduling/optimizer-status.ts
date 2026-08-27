/**
 * Derives the display state of an optimizer proposal from the raw
 * agent_proposals row (status + outcome), for the Planning grid overlay.
 *
 * The underlying `agent_proposals.status` enum is shared by every proposal
 * kind and carries states a guest-move overlay has no use for, while the two
 * most meaningful distinctions for a move — "the guest said yes but nobody
 * has rebooked it yet" vs "actually rebooked" — aren't in `status` at all;
 * they live in `outcome.guest_response` / `outcome.rebooked_at`. This maps
 * both onto one flat, display-oriented union.
 *
 * See docs/plans/2026-08-23-cross-day-consolidation-optimizer.md for the
 * lifecycle, and OptimizerOverlay.tsx for how each state is drawn.
 */

/** Raw agent_proposals.status values a guest_move_request can hold. */
export type ProposalStatus =
  | 'shadow'
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'booking'
  | 'sending'
  | 'confirming'
  | 'executed'
  | 'skipped'

export interface ProposalOutcome {
  guest_response?: string | null
  rebooked_at?: string | null
}

/**
 * Display states, ordered by how far along the move is.
 *
 * - `possible`  — drafted but never sent; the opportunity still exists.
 * - `sending`   — mid-send (transient; the atomic claim before outreach).
 * - `awaiting`  — sent, waiting on the guest to answer.
 * - `accepted`  — guest said yes, but nobody has done the FareHarbor rebook yet.
 *                 This is the one that actually needs a human — surfaced
 *                 distinctly so it can't sit unnoticed.
 * - `finalized` — rebooked and closed out.
 * - `declined`  — guest said no.
 * - `expired`   — re-validation failed at send time, or the proposal lapsed.
 */
export type OptimizerDisplayState =
  | 'possible'
  | 'sending'
  | 'awaiting'
  | 'accepted'
  | 'finalized'
  | 'declined'
  | 'expired'

/** The three buckets the overlay groups states into for at-a-glance scanning. */
export type OptimizerPhase = 'possible' | 'in_progress' | 'finalized'

export function deriveOptimizerState(
  status: ProposalStatus | string | null | undefined,
  outcome?: ProposalOutcome | null,
): OptimizerDisplayState {
  const guestResponse = outcome?.guest_response ?? null
  const rebookedAt = outcome?.rebooked_at ?? null

  // A completed rebook wins over everything — it's the terminal success state,
  // and `status` may still read `approved` when the rebook was recorded.
  if (rebookedAt) return 'finalized'
  if (status === 'executed') return 'finalized'

  if (status === 'rejected' || status === 'skipped') return 'declined'
  if (status === 'expired') return 'expired'

  // Guest already answered, but no rebook recorded yet (checked before the
  // generic sent-states below, since status stays `approved` after the reply).
  if (guestResponse === 'accept') return 'accepted'
  if (guestResponse === 'decline') return 'declined'

  if (status === 'sending') return 'sending'
  if (status === 'approved' || status === 'proposed' || status === 'booking' || status === 'confirming') {
    return 'awaiting'
  }

  // 'shadow' and anything unrecognized: drafted, not yet acted on.
  return 'possible'
}

const PHASE_BY_STATE: Record<OptimizerDisplayState, OptimizerPhase> = {
  possible: 'possible',
  sending: 'in_progress',
  awaiting: 'in_progress',
  accepted: 'in_progress',
  finalized: 'finalized',
  declined: 'finalized',
  expired: 'finalized',
}

export function phaseForState(state: OptimizerDisplayState): OptimizerPhase {
  return PHASE_BY_STATE[state]
}

/** True when the move can still be sent (the "Approve & send" action applies). */
export function isSendable(state: OptimizerDisplayState): boolean {
  return state === 'possible'
}

/** True when the move is over — no further action will change it. */
export function isTerminal(state: OptimizerDisplayState): boolean {
  return state === 'finalized' || state === 'declined' || state === 'expired'
}
