'use client'

import { useState } from 'react'
import { X, Ghost, Loader2, CheckCircle2, Send } from 'lucide-react'
import { formatAmsterdamTime, fmtEuros } from '@/lib/utils'
import { adminMutate } from '@/hooks/useAdminSave'
import type { GhostActivityItem } from '@/app/api/admin/planning/ghost-activity/route'

/** "Thu 6 Aug" from a plain YYYY-MM-DD, no timezone conversion — it's already a calendar date. */
function formatTargetDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * Side panel on the Planning page showing what the proactive scheduler has
 * actually DONE this week — captains it assigned on its own (autonomy
 * 'auto'), not proposals still waiting on a human. Mirrors the schedule_day
 * card styling on /admin/ghost (violet assignment chips, green "Applied"
 * confirmation) so the two surfaces read as the same system.
 */
export function GhostActivityPanel({
  items,
  isLoading,
  weekLabel,
  onClose,
  onConfirmed,
}: {
  items: GhostActivityItem[]
  isLoading: boolean
  weekLabel: string
  onClose: () => void
  /** Called after a successful confirm so the parent can refetch fresh notifiedCount/totalCount. */
  onConfirmed: () => void
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<{ id: string; message: string } | null>(null)

  async function confirmAndSend(id: string) {
    setConfirmingId(id)
    setConfirmError(null)
    try {
      await adminMutate(`/api/admin/planning/ghost-activity/${id}/confirm`, 'POST')
      onConfirmed()
    } catch (err) {
      setConfirmError({ id, message: err instanceof Error ? err.message : 'Could not send — try again.' })
    } finally {
      setConfirmingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <Ghost className="w-4 h-4 text-violet-500" />
            <div>
              <h2 className="text-base font-semibold text-zinc-900">Ghost activity</h2>
              <p className="text-xs text-zinc-400">{weekLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 px-5 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <div className="px-5 py-12 text-center text-zinc-400 text-sm">
              <Ghost className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
              <p>No captains assigned automatically this week yet.</p>
            </div>
          )}

          {items.map(item => (
            <div key={item.id} className="px-5 py-4 border-b border-zinc-50 last:border-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1.5">
                {formatTargetDate(item.target_date)}
              </p>
              <div className="space-y-1.5 mb-2">
                {item.assignments.map((a, i) => (
                  <div key={i} className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-violet-900">{a.staff_name ?? 'Captain'}</span>
                      {typeof a.cost_cents === 'number' && (
                        <span className="shrink-0 text-xs font-medium text-violet-700">{fmtEuros(a.cost_cents)}</span>
                      )}
                    </div>
                    {a.reason && <p className="text-violet-700 text-xs mt-0.5">{a.reason}</p>}
                  </div>
                ))}
              </div>
              {item.reasoning && <p className="text-xs text-zinc-500 mb-2">{item.reasoning}</p>}
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 inline-flex items-center gap-1.5 mb-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Applied · {item.assignments.length} assigned
                {item.applied_at ? ` · ${formatAmsterdamTime(item.applied_at)}` : ''}
              </p>

              {item.totalCount > 0 && item.notifiedCount >= item.totalCount ? (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Captain notified
                </p>
              ) : item.totalCount > 0 ? (
                <button
                  onClick={() => confirmAndSend(item.id)}
                  disabled={confirmingId === item.id}
                  className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  {confirmingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {confirmingId === item.id ? 'Sending…' : 'Confirm & send to captain'}
                </button>
              ) : null}
              {confirmError?.id === item.id && (
                <p className="text-xs text-red-600 mt-1.5">{confirmError.message}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
