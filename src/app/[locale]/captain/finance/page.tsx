'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Clock, Star, Wallet } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtEuros, amsterdamToday } from '@/lib/utils'
import { formatMinutes } from '@/lib/scheduling/payroll'
import { Unlinked, isUnlinked } from '../Unlinked'

interface ExtraHoursEntry {
  date: string
  extra_minutes: number
  amount_charged_cents: number
  commission_cents: number
  note: string | null
}

interface FinancePayload {
  month: string
  cruisedMinutes: number
  basePayCents: number
  reviewsAssigned: number
  reviewBonusCents: number
  extraHoursBonusCents: number
  extraHoursEntries: ExtraHoursEntry[]
  totalCents: number
}

function monthLabel(ym: string): string {
  return new Date(`${ym}-15T12:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 15)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function CaptainFinancePage() {
  const [month, setMonth] = useState(() => amsterdamToday().slice(0, 7))
  const { data, isLoading, error } = useAdminFetch<FinancePayload>(`/api/captain/finance?month=${month}`)

  if (isUnlinked(error)) return <Unlinked />

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Finance</h1>
        <p className="text-sm text-zinc-500 mt-1">Your hours, reviews, and bonuses, month by month.</p>
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

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                <Clock className="w-3.5 h-3.5" /> Cruised
              </div>
              <p className="text-xl font-semibold text-zinc-900 mt-1">{formatMinutes(data.cruisedMinutes)}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{fmtEuros(data.basePayCents)}</p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                <Star className="w-3.5 h-3.5" /> Reviews
              </div>
              <p className="text-xl font-semibold text-zinc-900 mt-1">{data.reviewsAssigned}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {data.reviewsAssigned === 0
                  ? 'no mentions yet'
                  : data.reviewBonusCents > 0
                    ? `+${fmtEuros(data.reviewBonusCents)}`
                    : 'bonus not paid out this month'}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    <Wallet className="w-3.5 h-3.5" /> Extra-hours bonus
                  </div>
                  <p className="text-xl font-semibold text-emerald-700 mt-1">
                    {data.extraHoursBonusCents > 0 ? `+${fmtEuros(data.extraHoursBonusCents)}` : '—'}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">50% commission on upsold time</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-zinc-900 text-white p-4 flex items-center justify-between">
            <span className="text-sm font-medium">Total this month</span>
            <span className="text-lg font-semibold">{fmtEuros(data.totalCents)}</span>
          </div>

          {data.extraHoursEntries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Upsells this month</p>
              <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
                {data.extraHoursEntries.map((x, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm text-zinc-800">
                        {new Date(`${x.date}T12:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' · '}+{x.extra_minutes} min
                      </p>
                      {x.note && <p className="text-xs text-zinc-400 mt-0.5">{x.note}</p>}
                    </div>
                    <span className="text-sm font-medium text-emerald-700">+{fmtEuros(x.commission_cents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
