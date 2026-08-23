'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, CircleDashed, AlertTriangle, CalendarClock } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { amsterdamToday } from '@/lib/utils'
import type { CaptainMonthStatus } from '@/lib/scheduling/availability-status'

interface StatusResponse {
  month: string
  captains: CaptainMonthStatus[]
  responded: number
  total: number
  unreachable: number
  nextRequest: { targetMonth: string; triggerDate: string; daysUntil: number }
}

function monthLabel(ym: string): string {
  return new Date(`${ym}-15T12:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 15)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Who has and hasn't filled in their availability for a month. The reminder
 * cron already knew this; nothing surfaced it (Beer, 2026-08-23).
 *
 * Deliberately leads with the UNREACHABLE count rather than burying it: a
 * captain with no Slack ID is silently skipped by the reminder forever, so
 * "0 of 4 responded" would otherwise look like four lazy captains instead of
 * a contact-details gap nobody can see.
 */
export function AvailabilityTab() {
  // Defaults to NEXT month — the one actually being collected, not the one
  // already underway.
  const [month, setMonth] = useState(() => shiftMonth(amsterdamToday().slice(0, 7), 1))
  const { data, isLoading, error } = useAdminFetch<StatusResponse>(
    `/api/admin/scheduling/availability-status?month=${month}`,
  )

  const captains = data?.captains ?? []
  const unreachable = captains.filter(c => !c.slackMemberId || !c.slackNotificationsEnabled)

  return (
    <div className="space-y-4">
      {/* Month switcher + summary */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-zinc-900 min-w-[9rem] text-center">{monthLabel(month)}</span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {data && (
          <span className="text-sm text-zinc-500">
            <span className="font-semibold text-zinc-900">{data.responded}</span> of {data.total} filled in
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* The finding that matters most — surfaced, not buried in a row detail. */}
      {unreachable.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {unreachable.length} captain{unreachable.length === 1 ? '' : 's'} can&apos;t be reminded at all
          </p>
          <p className="text-xs text-amber-800 mt-1">
            {unreachable.map(c => c.name).join(', ')} — the monthly reminder skips anyone without a Slack ID (or with
            notifications switched off). Add their Slack ID under the Staff tab and they&apos;ll be included from the
            next run.
          </p>
        </div>
      )}

      {/* Per-captain rows */}
      {data && captains.length > 0 && (
        <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
          {captains.map(c => {
            const reachable = !!c.slackMemberId && c.slackNotificationsEnabled
            return (
              <div key={c.staffId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {c.hasResponded ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <CircleDashed className="w-4 h-4 text-zinc-300 shrink-0" />
                  )}
                  <span className="text-sm font-medium text-zinc-900 truncate">{c.name}</span>
                  {!reachable && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold shrink-0">
                      {c.slackMemberId ? 'notifications off' : 'no Slack ID'}
                    </span>
                  )}
                </div>
                <span className={`text-xs shrink-0 ${c.hasResponded ? 'text-zinc-500' : 'text-zinc-400 italic'}`}>
                  {c.hasResponded ? `${c.daysFilled} day${c.daysFilled === 1 ? '' : 's'} marked` : 'nothing yet'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {data && captains.length === 0 && !isLoading && (
        <p className="text-sm text-zinc-400 py-8 text-center">No active captains.</p>
      )}

      {/* When the next automatic ask goes out — so you know whether to nudge yourself. */}
      {data?.nextRequest && (
        <p className="text-xs text-zinc-400 flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5 shrink-0" />
          Next automatic request: {monthLabel(data.nextRequest.targetMonth)}, going out{' '}
          {data.nextRequest.daysUntil === 0 ? 'today' : `in ${data.nextRequest.daysUntil} days`} (
          {data.nextRequest.triggerDate}).
        </p>
      )}
    </div>
  )
}
