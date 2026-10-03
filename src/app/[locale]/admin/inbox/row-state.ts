/**
 * Optimistic inbox rows — the list reacts the instant Beer clicks, instead of
 * waiting for the server round-trip and the next poll.
 *
 * A click creates a "pending" entry (new status, or read/unread). The list
 * renders the pending value on top of what the server last said, until the
 * server catches up. Pure functions only, so the rules below are unit-tested
 * (row-state.test.ts) and the components stay dumb.
 *
 * When is a pending entry done ("settled")?
 *  - the server agrees (status/unread matches) or dropped the row from this
 *    list (it left the filter, as intended) — but only once the write was
 *    confirmed, never on a guess;
 *  - something new arrived on the thread (its last_message_at moved) — the
 *    server's fresh state is more true than an old click;
 *  - OPTIMISTIC_TTL_MS passed — a safety net so a write we never heard back
 *    from can't leave a row wrong forever.
 * Only the client's own clock is compared with startedAt; server timestamps
 * are only ever compared with other server timestamps, so clock skew between
 * Beer's laptop and the server can't break this.
 */

export type WorkflowStatus = 'open' | 'pending' | 'resolved'
export type StatusFilter = WorkflowStatus | 'all'

/** How long the "done ✓" tint shows before the row starts sliding away. */
export const FLASH_MS = 220
/** After this the server's word wins again, whatever it says. */
export const OPTIMISTIC_TTL_MS = 20_000

export interface PendingStatus {
  status: WorkflowStatus
  /** Client clock, for the TTL only. */
  startedAt: number
  /** The row's last_message_at at click time — if it changes, something new arrived. */
  baselineLastMessageAt: string
  /** 'flash' = tinted, still in place. 'applied' = flash done; the row leaves now if the new status is outside the current filter. */
  phase: 'flash' | 'applied'
  /** The PATCH succeeded. Until then nothing is written, so the server "agreeing" can't settle it. */
  confirmed: boolean
}

export interface PendingUnread {
  unread: boolean
  startedAt: number
  baselineLastMessageAt: string
  confirmed: boolean
}

export interface RowLike {
  id: string
  status: WorkflowStatus
  last_message_at: string
  unread_count: number
}

/** Does this status take the row out of the list being looked at? */
export function leavesFilter(status: WorkflowStatus, filter: StatusFilter): boolean {
  return filter !== 'all' && status !== filter
}

/** Leave the row out of the rendered list now? (The list's exit animation then plays.) */
export function isOptimisticallyHidden(pending: PendingStatus | undefined, filter: StatusFilter): boolean {
  return !!pending && pending.phase === 'applied' && leavesFilter(pending.status, filter)
}

function expiredOrSuperseded(p: { startedAt: number; baselineLastMessageAt: string }, row: RowLike | undefined, now: number): boolean {
  if (now - p.startedAt >= OPTIMISTIC_TTL_MS) return true
  return !!row && row.last_message_at !== p.baselineLastMessageAt
}

export function statusSettled(p: PendingStatus, row: RowLike | undefined, now: number): boolean {
  if (expiredOrSuperseded(p, row, now)) return true
  if (!p.confirmed) return false
  return !row || row.status === p.status
}

export function unreadSettled(p: PendingUnread, row: RowLike | undefined, now: number): boolean {
  if (expiredOrSuperseded(p, row, now)) return true
  if (!p.confirmed) return false
  return !row || row.unread_count > 0 === p.unread
}

/**
 * The entries still in effect. Returns the SAME object when nothing was
 * dropped, so a caller holding it in state doesn't re-render for nothing.
 */
export function activePending<P>(
  pending: Record<string, P>,
  rows: RowLike[],
  settled: (p: P, row: RowLike | undefined, now: number) => boolean,
  now: number,
): Record<string, P> {
  const ids = Object.keys(pending)
  if (ids.length === 0) return pending
  const byId = new Map(rows.map(r => [r.id, r]))
  let next: Record<string, P> | null = null
  for (const id of ids) {
    if (settled(pending[id], byId.get(id), now)) {
      if (!next) next = { ...pending }
      delete next[id]
    }
  }
  return next ?? pending
}

export function effectiveStatus(row: RowLike, pending: PendingStatus | undefined): WorkflowStatus {
  return pending?.status ?? row.status
}

export function effectiveUnread(row: RowLike, pending: PendingUnread | undefined): boolean {
  return pending ? pending.unread : row.unread_count > 0
}
