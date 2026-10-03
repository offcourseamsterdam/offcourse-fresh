import { describe, it, expect } from 'vitest'
import {
  OPTIMISTIC_TTL_MS,
  activePending,
  effectiveStatus,
  effectiveUnread,
  isOptimisticallyHidden,
  leavesFilter,
  statusSettled,
  unreadSettled,
  type PendingStatus,
  type PendingUnread,
  type RowLike,
} from './row-state'

const T0 = 1_000_000
const row = (over: Partial<RowLike> = {}): RowLike => ({ id: 'c1', status: 'open', last_message_at: '2026-10-03T10:00:00Z', unread_count: 0, ...over })
const status = (over: Partial<PendingStatus> = {}): PendingStatus => ({
  status: 'resolved',
  startedAt: T0,
  baselineLastMessageAt: '2026-10-03T10:00:00Z',
  phase: 'applied',
  confirmed: true,
  ...over,
})
const unread = (over: Partial<PendingUnread> = {}): PendingUnread => ({
  unread: true,
  startedAt: T0,
  baselineLastMessageAt: '2026-10-03T10:00:00Z',
  confirmed: true,
  ...over,
})

describe('leavesFilter / isOptimisticallyHidden', () => {
  it('a row leaves only when its new status is outside the filter being viewed', () => {
    expect(leavesFilter('resolved', 'open')).toBe(true)
    expect(leavesFilter('open', 'open')).toBe(false)
    expect(leavesFilter('resolved', 'all')).toBe(false)
  })

  it('stays in place during the flash, then leaves', () => {
    expect(isOptimisticallyHidden(status({ phase: 'flash' }), 'open')).toBe(false)
    expect(isOptimisticallyHidden(status({ phase: 'applied' }), 'open')).toBe(true)
    expect(isOptimisticallyHidden(status({ phase: 'applied' }), 'all')).toBe(false)
    expect(isOptimisticallyHidden(undefined, 'open')).toBe(false)
  })
})

describe('statusSettled', () => {
  it('waits while the write is unconfirmed, even if the row vanished from a poll', () => {
    expect(statusSettled(status({ confirmed: false }), undefined, T0 + 100)).toBe(false)
    expect(statusSettled(status({ confirmed: false }), row(), T0 + 100)).toBe(false)
  })

  it('settles once confirmed and the server agrees or dropped the row', () => {
    expect(statusSettled(status(), row({ status: 'resolved' }), T0 + 100)).toBe(true)
    expect(statusSettled(status(), undefined, T0 + 100)).toBe(true)
  })

  it('keeps hiding a stale row from a poll that started before the write landed', () => {
    expect(statusSettled(status(), row({ status: 'open' }), T0 + 100)).toBe(false)
  })

  it('lets the server win as soon as something new arrives on the thread (a guest replied)', () => {
    expect(statusSettled(status({ confirmed: false }), row({ status: 'open', last_message_at: '2026-10-03T10:05:00Z' }), T0 + 100)).toBe(true)
  })

  it('gives up after the TTL whatever happened', () => {
    expect(statusSettled(status({ confirmed: false }), row(), T0 + OPTIMISTIC_TTL_MS)).toBe(true)
  })
})

describe('unreadSettled', () => {
  it('settles when the server count matches the wish', () => {
    expect(unreadSettled(unread({ unread: true }), row({ unread_count: 1 }), T0 + 1)).toBe(true)
    expect(unreadSettled(unread({ unread: false }), row({ unread_count: 0 }), T0 + 1)).toBe(true)
  })

  it('holds while the server still says the opposite', () => {
    expect(unreadSettled(unread({ unread: true }), row({ unread_count: 0 }), T0 + 1)).toBe(false)
    expect(unreadSettled(unread({ unread: true, confirmed: false }), row({ unread_count: 1 }), T0 + 1)).toBe(false)
  })

  it('a new message beats an old "mark read" click', () => {
    expect(unreadSettled(unread({ unread: false }), row({ unread_count: 1, last_message_at: '2026-10-03T11:00:00Z' }), T0 + 1)).toBe(true)
  })
})

describe('activePending', () => {
  it('returns the very same object when nothing settled (no needless re-render)', () => {
    const pending = { c1: status({ confirmed: false }) }
    expect(activePending(pending, [row()], statusSettled, T0 + 1)).toBe(pending)
    const empty = {}
    expect(activePending(empty, [row()], statusSettled, T0 + 1)).toBe(empty)
  })

  it('drops settled entries and keeps the rest', () => {
    const pending = { c1: status(), c2: status({ confirmed: false }) }
    const rows = [row({ id: 'c1', status: 'resolved' }), row({ id: 'c2' })]
    expect(Object.keys(activePending(pending, rows, statusSettled, T0 + 1))).toEqual(['c2'])
  })
})

describe('effective values', () => {
  it('pending wins over the server until it settles', () => {
    expect(effectiveStatus(row(), status({ status: 'pending' }))).toBe('pending')
    expect(effectiveStatus(row(), undefined)).toBe('open')
    expect(effectiveUnread(row({ unread_count: 3 }), unread({ unread: false }))).toBe(false)
    expect(effectiveUnread(row({ unread_count: 3 }), undefined)).toBe(true)
  })
})
