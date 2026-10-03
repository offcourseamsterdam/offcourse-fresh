'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminMutate, AdminApiError } from '@/hooks/useAdminSave'
import {
  FLASH_MS,
  activePending,
  statusSettled,
  unreadSettled,
  type PendingStatus,
  type PendingUnread,
  type WorkflowStatus,
} from './row-state'
import type { InboxListItem } from './types'

const PRUNE_EVERY_MS = 2_000

/**
 * The inbox's row actions — status changes and read/unread — applied to the
 * screen the instant Beer clicks, then written to the server in the
 * background. The rules for when the screen hands control back to the server
 * live in row-state.ts (pure, unit-tested); this hook only owns the timers,
 * the requests and the state.
 *
 * Robustness, in plain terms:
 *  - Read/unread writes for one conversation are queued, never raced: "open
 *    the thread (mark read)" then "mark unread" always lands in that order.
 *  - A failed write rolls the row back on screen and shows why — the list
 *    never pretends something saved when it didn't.
 *  - A double click on the same row's status is ignored while one is in flight.
 */
export function useInboxRowActions({ conversations, onSaved }: { conversations: InboxListItem[]; onSaved: () => void }) {
  const [rawStatus, setRawStatus] = useState<Record<string, PendingStatus>>({})
  const [rawUnread, setRawUnread] = useState<Record<string, PendingUnread>>({})
  const [error, setError] = useState<string | null>(null)
  // A clock in state (not Date.now() during render) so the TTL check stays pure.
  const [now, setNow] = useState(() => Date.now())

  const rowsRef = useRef(conversations)
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    rowsRef.current = conversations
    onSavedRef.current = onSaved
  })

  const statusInFlight = useRef(new Set<string>())
  const unreadQueue = useRef(new Map<string, Promise<unknown>>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending) clearTimeout(t)
    }
  }, [])

  // While anything is pending: tick the clock (TTL) and drop settled entries.
  const hasPending = Object.keys(rawStatus).length > 0 || Object.keys(rawUnread).length > 0
  useEffect(() => {
    if (!hasPending) return
    const interval = setInterval(() => {
      const t = Date.now()
      setNow(t)
      setRawStatus(p => activePending(p, rowsRef.current, statusSettled, t))
      setRawUnread(p => activePending(p, rowsRef.current, unreadSettled, t))
    }, PRUNE_EVERY_MS)
    return () => clearInterval(interval)
  }, [hasPending])

  // What the list renders: the raw entries minus anything the latest server data already settled.
  const pendingStatus = useMemo(() => activePending(rawStatus, conversations, statusSettled, now), [rawStatus, conversations, now])
  const pendingUnread = useMemo(() => activePending(rawUnread, conversations, unreadSettled, now), [rawUnread, conversations, now])

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])

  const changeStatus = useCallback(
    async (id: string, status: WorkflowStatus): Promise<boolean> => {
      if (statusInFlight.current.has(id)) return false
      statusInFlight.current.add(id)
      setError(null)
      const startedAt = Date.now()
      const row = rowsRef.current.find(r => r.id === id)
      const isMine = (p: Record<string, PendingStatus>) => p[id]?.startedAt === startedAt

      // The row may not be in the list (e.g. changed from the thread pane while
      // a filter hides it) — then there's nothing to animate, just save.
      if (row) {
        setRawStatus(p => ({ ...p, [id]: { status, startedAt, baselineLastMessageAt: row.last_message_at, phase: 'flash', confirmed: false } }))
        later(FLASH_MS, () => setRawStatus(p => (isMine(p) ? { ...p, [id]: { ...p[id], phase: 'applied' } } : p)))
      }
      try {
        // Never refresh before the flash has been seen: a fast save would
        // otherwise yank the row away mid-tint.
        await Promise.all([
          adminMutate(`/api/admin/inbox/conversations/${id}`, 'PATCH', { status }),
          new Promise(resolve => setTimeout(resolve, FLASH_MS)),
        ])
        setRawStatus(p => (isMine(p) ? { ...p, [id]: { ...p[id], confirmed: true } } : p))
        onSavedRef.current()
        return true
      } catch (err) {
        setRawStatus(p => {
          if (!isMine(p)) return p
          const { [id]: _rolledBack, ...rest } = p
          return rest
        })
        setError(`Couldn't change the status — ${err instanceof AdminApiError || err instanceof Error ? err.message : 'network error'}. Nothing was changed.`)
        return false
      } finally {
        statusInFlight.current.delete(id)
      }
    },
    [later],
  )

  const setUnread = useCallback(async (id: string, unread: boolean): Promise<boolean> => {
    const startedAt = Date.now()
    const row = rowsRef.current.find(r => r.id === id)
    const isMine = (p: Record<string, PendingUnread>) => p[id]?.startedAt === startedAt
    if (row) {
      setRawUnread(p => ({ ...p, [id]: { unread, startedAt, baselineLastMessageAt: row.last_message_at, confirmed: false } }))
    }
    // One queue per conversation: this write waits for the previous one, so
    // they reach the server in click order.
    const previous = unreadQueue.current.get(id) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(() => adminMutate(`/api/admin/inbox/conversations/${id}`, 'PATCH', { unread }))
    unreadQueue.current.set(id, run)
    try {
      await run
      setRawUnread(p => (isMine(p) ? { ...p, [id]: { ...p[id], confirmed: true } } : p))
      onSavedRef.current()
      return true
    } catch (err) {
      setRawUnread(p => {
        if (!isMine(p)) return p
        const { [id]: _rolledBack, ...rest } = p
        return rest
      })
      setError(`Couldn't mark it ${unread ? 'unread' : 'read'} — ${err instanceof Error ? err.message : 'network error'}.`)
      return false
    } finally {
      if (unreadQueue.current.get(id) === run) unreadQueue.current.delete(id)
    }
  }, [])

  return { pendingStatus, pendingUnread, changeStatus, setUnread, error, dismissError: () => setError(null) }
}
