'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { amsterdamToday } from '@/lib/utils'
import { Unlinked, isUnlinked } from '../Unlinked'

type Status = 'available' | 'prefer_not' | 'unavailable'

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
    availability: { date: string; status: Status }[]
  }>(`/api/captain/availability?from=${from}&to=${to}`)

  const byDate = useMemo(() => {
    const map: Record<string, Status> = {}
    for (const a of data?.availability ?? []) map[a.date] = a.status
    return map
  }, [data])

  const [saveError, setSaveError] = useState<string | null>(null)
  const today = amsterdamToday()

  async function cycle(date: string) {
    const current = byDate[date] ?? 'unset'
    const next = NEXT[current]
    setSaveError(null)
    // optimistic
    mutate(prev => {
      if (!prev) return prev
      const rest = prev.availability.filter(a => a.date !== date)
      return { availability: next ? [...rest, { date, status: next }] : rest }
    }, { revalidate: false })
    try {
      await adminMutate('/api/captain/availability', 'PUT', { date, status: next })
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
              const status = byDate[date] ?? 'unset'
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
