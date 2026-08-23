'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, Clock } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { amsterdamToday } from '@/lib/utils'
import { Unlinked, isUnlinked } from '../Unlinked'

type Status = 'available' | 'prefer_not' | 'unavailable'

interface DayEntry {
  status: Status
  startTime: string | null
  endTime: string | null
}

/** Tap cycle: unset → available → prefer_not → unavailable → unset. */
const NEXT: Record<string, Status | null> = {
  unset: 'available',
  available: 'prefer_not',
  prefer_not: 'unavailable',
  unavailable: null,
}

const CELL_STYLE: Record<string, string> = {
  available: 'bg-emerald-100 border-emerald-300 text-emerald-800',
  prefer_not: 'bg-amber-100 border-amber-300 text-amber-800',
  unavailable: 'bg-red-100 border-red-300 text-red-700',
  unset: 'bg-white border-zinc-200 text-zinc-700',
}

const LABEL: Record<string, string> = {
  available: 'Available',
  prefer_not: 'Prefer not',
  unavailable: 'Unavailable',
}

function monthLabel(ym: string): string {
  return new Date(`${ym}-15T12:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 15)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function CaptainAvailabilityPage() {
  const [month, setMonth] = useState(() => amsterdamToday().slice(0, 7))

  const { days, from, to, leadingBlanks } = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const count = new Date(y, m, 0).getDate()
    const all = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
    // Monday-first column of the 1st
    const blanks = (new Date(y, m - 1, 1).getDay() + 6) % 7
    return { days: all, from: all[0], to: all[count - 1], leadingBlanks: blanks }
  }, [month])

  const { data, isLoading, error, mutate } = useAdminFetch<{
    availability: { date: string; status: Status; startTime: string | null; endTime: string | null }[]
  }>(`/api/captain/availability?from=${from}&to=${to}`)

  const byDate = useMemo(() => {
    const map: Record<string, DayEntry> = {}
    for (const a of data?.availability ?? []) map[a.date] = { status: a.status, startTime: a.startTime, endTime: a.endTime }
    return map
  }, [data])

  // Days where setting specific hours is meaningful — a day that's unset or
  // unavailable has no window to narrow.
  const hoursEligibleDays = useMemo(
    () => days.filter(d => byDate[d]?.status === 'available' || byDate[d]?.status === 'prefer_not'),
    [days, byDate],
  )

  const [saveError, setSaveError] = useState<string | null>(null)
  const [editingHours, setEditingHours] = useState<string | null>(null)
  const [draftTimes, setDraftTimes] = useState({ start: '09:00', end: '18:00' })
  const today = amsterdamToday()

  async function cycle(date: string) {
    const current = byDate[date]?.status ?? 'unset'
    const next = NEXT[current]
    setSaveError(null)

    // Toggling available ↔ prefer not keeps any hours already set for the
    // day; unavailable and clearing always drop them — same forcing rule
    // the API itself applies.
    const keepsHours = next === 'available' || next === 'prefer_not'
    const startTime = keepsHours ? (byDate[date]?.startTime ?? null) : null
    const endTime = keepsHours ? (byDate[date]?.endTime ?? null) : null

    // optimistic
    mutate(prev => {
      if (!prev) return prev
      const rest = prev.availability.filter(a => a.date !== date)
      return { availability: next ? [...rest, { date, status: next, startTime, endTime }] : rest }
    }, { revalidate: false })
    if (editingHours === date && !keepsHours) setEditingHours(null)
    try {
      await adminMutate('/api/captain/availability', 'PUT', { date, status: next, startTime, endTime })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save')
      mutate() // re-fetch truth
    }
  }

  function toggleHoursEditor(date: string) {
    const entry = byDate[date]
    setDraftTimes({ start: entry?.startTime ?? '09:00', end: entry?.endTime ?? '18:00' })
    setEditingHours(editingHours === date ? null : date)
  }

  async function applyHours(date: string, times: { start: string; end: string } | null) {
    const entry = byDate[date]
    if (!entry) return
    setSaveError(null)
    const startTime = times?.start ?? null
    const endTime = times?.end ?? null
    mutate(prev => {
      if (!prev) return prev
      return { availability: prev.availability.map(a => (a.date === date ? { ...a, startTime, endTime } : a)) }
    }, { revalidate: false })
    setEditingHours(null)
    try {
      await adminMutate('/api/captain/availability', 'PUT', { date, status: entry.status, startTime, endTime })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save')
      mutate() // re-fetch truth
    }
  }

  if (isUnlinked(error)) return <Unlinked />

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Availability</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Tap a day to cycle: available → prefer not → unavailable → clear.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => setMonth(m => shiftMonth(m, -1))}
          className="p-2.5 rounded-lg hover:bg-zinc-100 text-zinc-500 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-zinc-800">{monthLabel(month)}</span>
        <button
          onClick={() => setMonth(m => shiftMonth(m, 1))}
          className="p-2.5 rounded-lg hover:bg-zinc-100 text-zinc-500 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {error && !isUnlinked(error) && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      {saveError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium text-zinc-400">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {days.map(date => {
              const status = byDate[date]?.status ?? 'unset'
              return (
                <button
                  key={date}
                  onClick={() => cycle(date)}
                  className={`aspect-square min-h-[44px] rounded-xl border text-sm font-medium transition-colors ${CELL_STYLE[status]} ${date === today ? 'ring-2 ring-zinc-900 ring-offset-1' : ''}`}
                >
                  {Number(date.slice(8))}
                </button>
              )
            })}
          </div>

          {hoursEligibleDays.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Set hours (optional)</p>
              <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
                {hoursEligibleDays.map(date => {
                  const entry = byDate[date]!
                  const isOpen = editingHours === date
                  const summary = entry.startTime && entry.endTime ? `${entry.startTime}–${entry.endTime}` : 'All day'
                  const invalidRange = draftTimes.end <= draftTimes.start
                  return (
                    <div key={date}>
                      <button
                        onClick={() => toggleHoursEditor(date)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 min-h-[44px] text-left hover:bg-zinc-50"
                      >
                        <span className="flex items-center gap-2 text-sm text-zinc-800">
                          <span className={`w-2 h-2 rounded-full ${entry.status === 'available' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                          {new Date(`${date}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        <span className="flex items-center gap-1.5 text-sm text-zinc-500">
                          <Clock className="w-3.5 h-3.5" />
                          {summary}
                          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 space-y-3 bg-zinc-50">
                          <div className="flex items-center gap-3">
                            <label className="flex-1 text-xs text-zinc-500">
                              From
                              <input
                                type="time"
                                value={draftTimes.start}
                                onChange={e => setDraftTimes(t => ({ ...t, start: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm min-h-[44px]"
                              />
                            </label>
                            <label className="flex-1 text-xs text-zinc-500">
                              Until
                              <input
                                type="time"
                                value={draftTimes.end}
                                onChange={e => setDraftTimes(t => ({ ...t, end: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm min-h-[44px]"
                              />
                            </label>
                          </div>
                          {invalidRange && <p className="text-xs text-red-600">End must be after start.</p>}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => applyHours(date, draftTimes)}
                              disabled={invalidRange}
                              className="flex-1 min-h-[44px] rounded-lg bg-zinc-900 text-white text-sm font-medium disabled:opacity-40"
                            >
                              Save
                            </button>
                            {(entry.startTime || entry.endTime) && (
                              <button
                                onClick={() => applyHours(date, null)}
                                className="min-h-[44px] px-3 rounded-lg border border-zinc-300 text-sm text-zinc-600"
                              >
                                All day instead
                              </button>
                            )}
                            <button onClick={() => setEditingHours(null)} className="min-h-[44px] px-3 rounded-lg text-sm text-zinc-400">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500 pt-1">
            {(['available', 'prefer_not', 'unavailable'] as const).map(s => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded border ${CELL_STYLE[s]}`} />
                {LABEL[s]}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
