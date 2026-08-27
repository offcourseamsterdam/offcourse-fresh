'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Sparkles, Loader2, Send, CheckCircle2, Clock, Merge } from 'lucide-react'
import { fmtCostEuros } from '@/lib/scheduling/shift-cost'
import { adminMutate } from '@/hooks/useAdminSave'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { OptimizerItem } from '@/app/api/admin/planning/optimizer/route'

/** "Wed 26 Aug" from a plain YYYY-MM-DD. */
function formatItemDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const KIND_META: Record<OptimizerItem['kind'], { label: string; Icon: typeof Clock; color: string }> = {
  same_day_gap: { label: 'Paid gap', Icon: Clock, color: 'text-amber-600' },
  same_day_merge: { label: 'Could consolidate boats', Icon: Merge, color: 'text-amber-600' },
  cross_day_consolidation: { label: 'Cross-day consolidation', Icon: Sparkles, color: 'text-violet-500' },
}

/**
 * Dedicated Optimizer panel (Beer, 2026-08-23: "a new, dedicated panel" —
 * not folded into /admin/ghost's review page). Every schedule inefficiency:
 * same-day paid gaps (informational only — no ask exists for these yet);
 * same-day boat swaps and cross-day consolidation are both actionable here
 * (approve sends the drafted SMS/email straight away) — same underlying
 * guest_move_request proposal either way, just a different move_type.
 *
 * Takes no date-range props on purpose (Beer, 2026-08-23: "always from the
 * point of view of today, not the past week") — the route itself always
 * scans today → today + the standard horizon, regardless of which week
 * Planning happens to be scrolled to. `from`/`to` here are only what the
 * route's response says it actually scanned, for the header label.
 *
 * See docs/plans/2026-08-23-cross-day-consolidation-optimizer.md.
 */
export function OptimizerPanel({
  onClose,
  focusProposalId,
}: {
  onClose: () => void
  /** Set when the panel was opened by clicking a marker on the grid overlay —
   *  that proposal is scrolled to and briefly ringed, so the click lands you
   *  on the right card instead of at the top of a long list. */
  focusProposalId?: string | null
}) {
  const { data, isLoading, error, refresh } = useAdminFetch<{ items: OptimizerItem[]; from: string; to: string }>(
    '/api/admin/planning/optimizer',
  )
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [sendError, setSendError] = useState<{ id: string; message: string } | null>(null)
  const focusRef = useRef<HTMLDivElement>(null)

  // Scroll after the list has actually rendered — on first open the fetch is
  // still in flight, so the target card doesn't exist yet when this component
  // mounts. Re-runs when the data arrives.
  useEffect(() => {
    if (!focusProposalId || !data) return
    focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusProposalId, data])

  async function approveAndSend(proposalId: string) {
    setSendingId(proposalId)
    setSendError(null)
    try {
      await adminMutate(`/api/admin/ghost/proposals/${proposalId}`, 'POST', { action: 'send_move' })
      setSentIds(prev => new Set(prev).add(proposalId))
    } catch (err) {
      setSendError({ id: proposalId, message: err instanceof Error ? err.message : 'Could not send — try again.' })
    } finally {
      setSendingId(null)
    }
  }

  const items = data?.items ?? []
  const totalSavingCents = items.reduce((sum, i) => sum + (i.estSavingCents ?? 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Optimizer</h2>
              <p className="text-xs text-zinc-400">
                {data ? `${formatItemDate(data.from)} – ${formatItemDate(data.to)}` : 'Looking ahead from today'}
                {totalSavingCents > 0 && ` · up to ${fmtCostEuros(totalSavingCents)} found`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 px-5 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Scanning the schedule…
            </div>
          )}

          {error && <p className="px-5 py-4 text-sm text-red-600">{error}</p>}

          {!isLoading && !error && items.length === 0 && (
            <div className="px-5 py-12 text-center text-zinc-400 text-sm">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
              <p>Nothing to optimize in this range — every shift looks tight already.</p>
            </div>
          )}

          {items.map((item, i) => {
            const meta = KIND_META[item.kind]
            const isActionable = item.kind === 'cross_day_consolidation' || item.kind === 'same_day_merge'
            const sent = !!item.proposalId && sentIds.has(item.proposalId)
            const isFocused = !!focusProposalId && item.proposalId === focusProposalId
            return (
              <div
                key={`${item.kind}-${item.date}-${item.boat}-${i}`}
                ref={isFocused ? focusRef : undefined}
                className={`px-5 py-4 border-b border-zinc-50 last:border-0 ${
                  isFocused ? 'bg-violet-50 ring-1 ring-inset ring-violet-200' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${meta.color}`}>
                    <meta.Icon className="w-3 h-3" /> {meta.label}
                  </span>
                  {item.estSavingCents != null && item.estSavingCents > 0 && (
                    <span className="text-xs font-semibold text-emerald-700 shrink-0">{fmtCostEuros(item.estSavingCents)}</span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 mb-1">{formatItemDate(item.date)} · {item.boat}</p>
                <p className="text-sm text-zinc-800 mb-2">{item.summary}</p>

                {isActionable && (
                  <>
                    {(item.smsText || item.emailBody) && (
                      <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-xs text-violet-800 space-y-1 mb-2">
                        {item.smsText && (
                          <p><span className="font-semibold">SMS:</span> {item.smsText}</p>
                        )}
                        {item.emailSubject && (
                          <p><span className="font-semibold">Email:</span> {item.emailSubject}</p>
                        )}
                      </div>
                    )}
                    {sent || (item.state && item.state !== 'possible') ? (
                      // Real lifecycle state from the server, so this survives
                      // a refresh — `sentIds` alone only remembered within
                      // this mount, and read "not sent yet" ever after.
                      <p className={`text-xs rounded-lg px-3 py-2 inline-flex items-center gap-1.5 border ${
                        item.state === 'accepted'
                          ? 'text-indigo-800 bg-indigo-50 border-indigo-200 font-semibold'
                          : item.state === 'finalized'
                            ? 'text-indigo-700 bg-indigo-50 border-indigo-100'
                            : item.state === 'declined' || item.state === 'expired'
                              ? 'text-zinc-500 bg-zinc-50 border-zinc-200'
                              : 'text-teal-700 bg-teal-50 border-teal-100'
                      }`}>
                        <Send className="w-3.5 h-3.5" />
                        {item.state === 'accepted'
                          ? `${item.guestName ?? 'The guest'} accepted — rebook it in FareHarbor`
                          : item.state === 'finalized'
                            ? 'Rebooked'
                            : item.state === 'declined'
                              ? `${item.guestName ?? 'The guest'} declined`
                              : item.state === 'expired'
                                ? 'Expired before it could be sent'
                                : `Sent to ${item.guestName ?? 'the guest'} — awaiting their answer`}
                      </p>
                    ) : item.proposalId ? (
                      <button
                        onClick={() => approveAndSend(item.proposalId!)}
                        disabled={sendingId === item.proposalId}
                        className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                      >
                        {sendingId === item.proposalId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        {sendingId === item.proposalId ? 'Sending…' : `Approve & send to ${item.guestName ?? 'guest'}`}
                      </button>
                    ) : (
                      <p className="text-xs text-zinc-400 italic">Drafting…</p>
                    )}
                    {sendError && sendError.id === item.proposalId && (
                      <p className="text-xs text-red-600 mt-1.5">{sendError.message}</p>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-5 py-2.5 border-t border-zinc-100">
          <button onClick={refresh} className="text-xs font-medium text-zinc-500 hover:text-zinc-700">
            Refresh
          </button>
        </div>
      </div>
    </div>
  )
}
