'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtEuros, formatAmsterdamTime } from '@/lib/utils'
import {
  aggregatePayroll,
  formatMinutes,
  entryMinutes,
  entryPayCents,
  type PayrollTimeEntry,
} from '@/lib/scheduling/payroll'

interface PayrollEntry extends PayrollTimeEntry {
  source: string
  note: string | null
}
interface PayrollBonus {
  staff_id: string
  amount_cents: number
}
interface PayrollPayload {
  entries: PayrollEntry[]
  staff: { id: string; name: string; role: string }[]
  bonuses: PayrollBonus[]
  from: string
  to: string
}

const FLAG_LABEL: Record<string, string> = {
  auto_closed: 'Auto-closed',
  manual_edit: 'Manual edit',
  overlong: 'Overlong',
  no_shift: 'No shift',
}

function monthRange(d: Date): { from: string; to: string; label: string } {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return {
    from: iso(first),
    to: iso(last),
    label: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  }
}

export function PayrollTab() {
  const [cursor, setCursor] = useState(() => new Date())
  const { from, to, label } = useMemo(() => monthRange(cursor), [cursor])

  const { data, isLoading, error } = useAdminFetch<PayrollPayload>(
    `/api/admin/scheduling/payroll?from=${from}&to=${to}`,
  )

  const lines = useMemo(
    () => (data ? aggregatePayroll(data.entries, data.staff) : []),
    [data],
  )

  // Aggregate review bonuses per staff for the selected period.
  const bonusByStaff = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of data?.bonuses ?? []) {
      map.set(b.staff_id, (map.get(b.staff_id) ?? 0) + b.amount_cents)
    }
    return map
  }, [data])

  const totals = useMemo(
    () =>
      lines.reduce(
        (acc, l) => ({
          minutes: acc.minutes + l.totalMinutes,
          pay: acc.pay + l.totalPayCents,
          bonus: acc.bonus + (bonusByStaff.get(l.staffId) ?? 0),
          open: acc.open + l.openCount,
          flagged: acc.flagged + l.flaggedCount,
        }),
        { minutes: 0, pay: 0, bonus: 0, open: 0, flagged: 0 },
      ),
    [lines, bonusByStaff],
  )

  const flaggedEntries = useMemo(
    () => (data?.entries ?? []).filter(e => e.flag || !e.clock_out_at),
    [data],
  )

  function shiftMonth(delta: number) {
    setCursor(c => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            This month
          </Button>
          <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="ml-2 text-sm font-medium text-zinc-700">{label}</span>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-400 ml-1" />}
        </div>

        <a href={`/api/admin/scheduling/payroll/csv?from=${from}&to=${to}`} download>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
        </a>
      </div>

      {error && <AdminErrorBanner error={error} />}

      {/* Summary table */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-400 uppercase">
              <th className="px-4 py-3">Staff</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3 text-right">Shifts</th>
              <th className="px-4 py-3 text-right">Hours</th>
              <th className="px-4 py-3 text-right">Pay</th>
              <th className="px-4 py-3 text-right">Bonus</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Review</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && !isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-400">
                  No hours logged this month.
                </td>
              </tr>
            )}
            {lines.map(l => {
              const bonus = bonusByStaff.get(l.staffId) ?? 0
              return (
                <tr key={l.staffId} className="border-b border-zinc-50 hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900">{l.name}</td>
                  <td className="px-4 py-3 text-zinc-500 capitalize">{l.role}</td>
                  <td className="px-4 py-3 text-right text-zinc-700">{l.entryCount}</td>
                  <td className="px-4 py-3 text-right text-zinc-700">{formatMinutes(l.totalMinutes)}</td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900">{fmtEuros(l.totalPayCents)}</td>
                  <td className="px-4 py-3 text-right">
                    {bonus > 0 ? (
                      <span className="text-xs font-medium text-amber-700">+{fmtEuros(bonus)}</span>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-900">
                    {fmtEuros(l.totalPayCents + bonus)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.openCount > 0 && (
                      <span className="inline-block text-xs text-amber-700">{l.openCount} open</span>
                    )}
                    {l.flaggedCount > 0 && (
                      <span className="inline-block text-xs text-red-600 ml-2">{l.flaggedCount} flagged</span>
                    )}
                    {l.openCount === 0 && l.flaggedCount === 0 && (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-zinc-200 font-semibold text-zinc-900">
                <td className="px-4 py-3" colSpan={3}>Total</td>
                <td className="px-4 py-3 text-right">{formatMinutes(totals.minutes)}</td>
                <td className="px-4 py-3 text-right">{fmtEuros(totals.pay)}</td>
                <td className="px-4 py-3 text-right text-amber-700">
                  {totals.bonus > 0 ? `+${fmtEuros(totals.bonus)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right">{fmtEuros(totals.pay + totals.bonus)}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Entries needing review */}
      {flaggedEntries.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-zinc-700">Needs review</h3>
            <span className="text-xs text-zinc-400">({flaggedEntries.length})</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-400 uppercase">
                <th className="px-4 py-2">Staff</th>
                <th className="px-4 py-2">Clock in</th>
                <th className="px-4 py-2">Clock out</th>
                <th className="px-4 py-2 text-right">Hours</th>
                <th className="px-4 py-2 text-right">Pay</th>
                <th className="px-4 py-2">Flag</th>
              </tr>
            </thead>
            <tbody>
              {flaggedEntries.map(e => {
                const name = data?.staff.find(s => s.id === e.staff_id)?.name ?? 'Unknown'
                const minutes = entryMinutes(e)
                return (
                  <tr key={e.id} className="border-b border-zinc-50">
                    <td className="px-4 py-2 text-zinc-900">{name}</td>
                    <td className="px-4 py-2 text-zinc-600">
                      {new Date(e.clock_in_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam',
                      })}{' '}
                      {formatAmsterdamTime(e.clock_in_at)}
                    </td>
                    <td className="px-4 py-2 text-zinc-600">
                      {e.clock_out_at ? formatAmsterdamTime(e.clock_out_at) : (
                        <span className="text-amber-700">still open</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-600">
                      {minutes === null ? '—' : formatMinutes(minutes)}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-600">
                      {minutes === null ? '—' : fmtEuros(entryPayCents(e))}
                    </td>
                    <td className="px-4 py-2">
                      {e.flag ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                          {FLAG_LABEL[e.flag] ?? e.flag}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          Open
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
