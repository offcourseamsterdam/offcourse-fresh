'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, CircleDashed, AlertTriangle, CalendarClock } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { amsterdamToday } from '@/lib/utils'
import { availabilityDisplay, type AvailabilityDisplay, type CaptainMonthStatus, type DayAvailability } from '@/lib/scheduling/availability-status'

interface StatusResponse {
  month: string
  captains: CaptainMonthStatus[]
  days: DayAvailability[]
  responded: number
  total: number
  unreachable: number
  nextRequest: { targetMonth: string; triggerDate: string; daysUntil: number }
}

// Same availabilityDisplay() call as the captain's own calendar
// (captain/availability/page.tsx) — an admin looking at both must never see
// a different color mean a different thing. 'partly_available' (Beer,
// 2026-08-23: "available, or partly available") is derived from the hours
// window, not a status a captain picks directly.
const CELL_STYLE: Record<AvailabilityDisplay, string> = {
  available: 'bg-emerald-100 border-emerald-200',
  partly_available: 'bg-amber-100 border-amber-200',
  unavailable: 'bg-red-100 border-red-200',
  unset: '',
}
const STATUS_LABEL: Record<AvailabilityDisplay, string> = {
  available: 'Available',
  partly_available: 'Partly available',
  unavailable: 'Unavailable',
  unset: 'Not marked',
}
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function monthLabel(ym: string): string {
  return new Date(`${ym}-15T12:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 15)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Monday-first weekday abbreviation for a YYYY-MM-DD, parsed as a plain
 *  calendar date (not UTC-shifted — a date string has no time zone to slip). */
function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return WEEKDAY_SHORT[(new Date(y, m - 1, d).getDay() + 6) % 7]
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

      {/* Day-by-day, everyone at once (Beer, 2026-08-23: "I also want to see
          the calendar where I can see everyone's availability each day") —
          a different question from the rows above: not "who's responded"
          but "who's actually around on the 15th". */}
      {data && captains.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Day by day</p>
          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200">
                  <th className="text-left font-medium text-zinc-500 px-3 py-2 sticky left-0 bg-zinc-50 whitespace-nowrap">Day</th>
                  {captains.map(c => (
                    <th key={c.staffId} className="text-center font-medium text-zinc-500 px-2 py-2 whitespace-nowrap">
                      {c.name.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.days.map(day => {
                  const isToday = day.date === amsterdamToday()
                  const isWeekend = weekdayShort(day.date) === 'Sat' || weekdayShort(day.date) === 'Sun'
                  return (
                    <tr key={day.date} className={`border-b border-zinc-100 last:border-0 ${isToday ? 'bg-indigo-50/60' : isWeekend ? 'bg-zinc-50/60' : ''}`}>
                      <td className={`px-3 py-1.5 whitespace-nowrap sticky left-0 ${isToday ? 'bg-indigo-50/60 font-semibold text-indigo-700' : isWeekend ? 'bg-zinc-50/60 text-zinc-500' : 'bg-white text-zinc-500'}`}>
                        {Number(day.date.slice(-2))} <span className="text-zinc-400">{weekdayShort(day.date)}</span>
                      </td>
                      {captains.map(c => {
                        const entry = day.byStaffId[c.staffId]
                        const display = availabilityDisplay(entry)
                        if (display === 'unset') {
                          return (
                            <td key={c.staffId} className="px-2 py-1.5 text-center">
                              <span className="text-zinc-200">—</span>
                            </td>
                          )
                        }
                        // Partly available: show the actual window, not just the
                        // label — Beer, 2026-08-23: "if people make it red we know
                        // not to call them for last minutes", the amber case is
                        // exactly where the hours are the decision-relevant fact.
                        const cellText =
                          display === 'partly_available' && entry ? `${entry.startTime}–${entry.endTime}` : STATUS_LABEL[display]
                        return (
                          <td key={c.staffId} className="px-2 py-1.5 text-center">
                            <span
                              title={`${c.name}: ${STATUS_LABEL[display]}`}
                              className={`inline-block w-full min-w-[2.5rem] rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${CELL_STYLE[display]}`}
                            >
                              {cellText}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-zinc-400">
            {(['available', 'partly_available', 'unavailable'] as const).map(s => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded border ${CELL_STYLE[s]}`} />
                {STATUS_LABEL[s]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="text-zinc-200">—</span> Not marked
            </span>
          </div>
        </div>
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
