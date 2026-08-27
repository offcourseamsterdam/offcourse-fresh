/**
 * Pure view-model for the Planning grid's optimizer overlay.
 *
 * Kept out of the component so the indexing and the visual vocabulary are
 * unit-testable on their own: the component then only positions what this
 * returns. See OptimizerOverlay.tsx for the drawing, and
 * src/lib/scheduling/optimizer-status.ts for how a raw agent_proposals row
 * becomes one of the display states used here.
 */

import type { OptimizerItem } from '@/app/api/admin/planning/optimizer/route'
import type { OptimizerDisplayState } from '@/lib/scheduling/optimizer-status'

/** How each display state is drawn. One accent family (violet/indigo) on
 *  purpose: the grid already spends amber on "no captain" and emerald on
 *  "assigned", so an optimizer marker must never be mistakable for captain
 *  status. State is carried by icon + border weight instead of by hue. */
export interface StateStyle {
  /** lucide icon name, resolved by the component. */
  icon: 'sparkles' | 'send' | 'clock' | 'check' | 'x' | 'alert'
  label: string
  /** Tailwind classes for the marker's ring/border. */
  ring: string
  /** Tailwind classes for the marker's fill. */
  fill: string
  /** Tailwind class for icon/text colour. */
  text: string
  /** Terminal states are drawn muted — they're history, not a to-do. */
  muted: boolean
}

export const STATE_STYLES: Record<OptimizerDisplayState, StateStyle> = {
  possible: {
    // Dashed border (not ring — Tailwind rings can't be dashed) says
    // "drafted, nothing sent yet" at a glance.
    icon: 'sparkles',
    label: 'Possible',
    ring: 'border border-dashed border-violet-400',
    fill: 'bg-violet-50',
    text: 'text-violet-600',
    muted: false,
  },
  sending: {
    icon: 'send',
    label: 'Sending',
    ring: 'border border-violet-500',
    fill: 'bg-violet-100',
    text: 'text-violet-700',
    muted: false,
  },
  awaiting: {
    icon: 'clock',
    label: 'Awaiting guest',
    ring: 'border border-violet-500',
    fill: 'bg-violet-100',
    text: 'text-violet-700',
    muted: false,
  },
  accepted: {
    // The one that needs a human: guest said yes, nobody has rebooked it yet.
    // Heaviest treatment on the board for exactly that reason.
    icon: 'check',
    label: 'Accepted - rebook it',
    ring: 'border-2 border-indigo-600',
    fill: 'bg-indigo-100',
    text: 'text-indigo-700',
    muted: false,
  },
  finalized: {
    icon: 'check',
    label: 'Rebooked',
    ring: 'border border-indigo-600',
    fill: 'bg-indigo-600',
    text: 'text-white',
    muted: true,
  },
  declined: {
    icon: 'x',
    label: 'Guest declined',
    ring: 'border border-zinc-300',
    fill: 'bg-zinc-100',
    text: 'text-zinc-500',
    muted: true,
  },
  expired: {
    icon: 'alert',
    label: 'Expired',
    ring: 'border border-zinc-300',
    fill: 'bg-zinc-100',
    text: 'text-zinc-500',
    muted: true,
  },
}

/** An actionable move (boat swap or cross-day), anchored to a booking. */
export interface MoveMarker {
  item: OptimizerItem
  bookingId: string
  state: OptimizerDisplayState
  /** Same-day boat swap: the lane to draw the connector to. */
  toBoat?: string
  /** Cross-day: the day to jump to. */
  toDate?: string
}

/** An idle span with no ask behind it — drawn as a ghost outline only. */
export interface GapMarker {
  item: OptimizerItem
  date: string
  boat: string
  startAt: string
  endAt: string
}

export interface OverlayModel {
  /** Keyed by booking id — the grid looks these up per departure chip. */
  movesByBooking: Map<string, MoveMarker>
  /** Keyed by `${date}|${boat}` — the grid looks these up per lane. */
  gapsByLane: Map<string, GapMarker[]>
  counts: Record<'possible' | 'in_progress' | 'finalized', number>
  totalSavingCents: number
}

export function laneKey(date: string, boat: string): string {
  return `${date}|${boat}`
}

/**
 * Indexes optimizer findings for O(1) lookup while rendering the grid.
 *
 * A booking can in principle have both a boat-swap and a cross-day finding;
 * the live one wins, so the grid never shows a stale "possible" marker over a
 * move that's already out with the guest. Ties break toward the item with a
 * real proposal, then toward the larger saving.
 */
export function buildOverlayModel(items: OptimizerItem[]): OverlayModel {
  const movesByBooking = new Map<string, MoveMarker>()
  const gapsByLane = new Map<string, GapMarker[]>()
  const counts = { possible: 0, in_progress: 0, finalized: 0 }
  let totalSavingCents = 0

  for (const item of items) {
    totalSavingCents += item.estSavingCents ?? 0

    if (item.kind === 'same_day_gap') {
      if (!item.gapStartAt || !item.gapEndAt) continue
      const key = laneKey(item.date, item.boat)
      const bucket = gapsByLane.get(key) ?? []
      bucket.push({ item, date: item.date, boat: item.boat, startAt: item.gapStartAt, endAt: item.gapEndAt })
      gapsByLane.set(key, bucket)
      continue
    }

    if (!item.bookingId) continue
    const state: OptimizerDisplayState = item.state ?? 'possible'
    const candidate: MoveMarker = {
      item,
      bookingId: item.bookingId,
      state,
      toBoat: item.toBoat,
      toDate: item.toDate,
    }
    const existing = movesByBooking.get(item.bookingId)
    if (!existing || preferMarker(candidate, existing)) {
      movesByBooking.set(item.bookingId, candidate)
    }
  }

  for (const marker of movesByBooking.values()) {
    const phase =
      marker.state === 'possible'
        ? 'possible'
        : marker.state === 'finalized' || marker.state === 'declined' || marker.state === 'expired'
          ? 'finalized'
          : 'in_progress'
    counts[phase] += 1
  }

  return { movesByBooking, gapsByLane, counts, totalSavingCents }
}

/** Higher wins. A live ask outranks an untouched draft, which outranks a
 *  finished one — so the grid shows what still needs attention. */
const STATE_RANK: Record<OptimizerDisplayState, number> = {
  accepted: 5,
  awaiting: 4,
  sending: 4,
  possible: 3,
  finalized: 2,
  declined: 1,
  expired: 1,
}

function preferMarker(a: MoveMarker, b: MoveMarker): boolean {
  const rankA = STATE_RANK[a.state]
  const rankB = STATE_RANK[b.state]
  if (rankA !== rankB) return rankA > rankB
  const hasProposalA = a.item.proposalId ? 1 : 0
  const hasProposalB = b.item.proposalId ? 1 : 0
  if (hasProposalA !== hasProposalB) return hasProposalA > hasProposalB
  return (a.item.estSavingCents ?? 0) > (b.item.estSavingCents ?? 0)
}
