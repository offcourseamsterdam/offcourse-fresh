'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { fmtEuros } from '@/lib/utils'

interface MonthRow {
  month: string
  bookings: number
  base_revenue_cents: number
  commission_cents: number
}

interface CommissionData {
  total_bookings: number
  total_commission_cents: number
  months: MonthRow[]
}

interface QuarterGroup {
  label: string
  months: MonthRow[]
  bookings: number
  base_revenue_cents: number
  commission_cents: number
}

function getQuarterLabel(month: string): string {
  const [year, mm] = month.split('-')
  const q = Math.ceil(Number(mm) / 3)
  return `Q${q} ${year}`
}

function groupByQuarter(months: MonthRow[]): QuarterGroup[] {
  const map: Record<string, QuarterGroup> = {}
  for (const m of months) {
    const key = getQuarterLabel(m.month)
    if (!map[key]) map[key] = { label: key, months: [], bookings: 0, base_revenue_cents: 0, commission_cents: 0 }
    map[key].months.push(m)
    map[key].bookings += m.bookings
    map[key].base_revenue_cents += m.base_revenue_cents
    map[key].commission_cents += m.commission_cents
  }
  return Object.values(map)
}

function formatMonth(month: string): string {
  const [year, mm] = month.split('-')
  return new Date(Number(year), Number(mm) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export default function PartnerCommissionPage() {
  const [data, setData] = useState<CommissionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/partner/commission')
        const json = await res.json()
        if (json.ok) setData(json.data)
        else setError(json.error ?? 'Failed to load commission data')
      } catch {
        setError('Network error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
  }

  if (error) {
    return <div className="p-6 sm:p-8"><p className="text-sm text-red-600">{error}</p></div>
  }

  if (!data) return null

  const quarters = groupByQuarter(data.months)

  return (
    <div className="p-6 sm:p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-primary)]">Commission Overview</h1>
        <p className="text-sm text-zinc-500 mt-1">Use this data to create your invoice.</p>
      </div>

      {/* All-time totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-6 border border-zinc-200">
          <p className="text-sm text-zinc-400 mb-2">Total bookings (all time)</p>
          <p className="text-3xl font-bold text-[var(--color-primary)]">{data.total_bookings}</p>
        </div>
        <div className="bg-white rounded-2xl p-6 border border-zinc-200">
          <p className="text-sm text-zinc-400 mb-2">Total commission (all time)</p>
          <p className="text-3xl font-bold text-[var(--color-primary)]">{fmtEuros(data.total_commission_cents)}</p>
        </div>
      </div>

      {/* Quarterly + monthly breakdown */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold text-[var(--color-primary)] mb-4">Breakdown by Quarter</h2>

        {data.months.length === 0 ? (
          <p className="text-sm text-zinc-400">No commission data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-400 border-b border-zinc-100">
                  <th className="pb-2 pr-4 font-medium">Period</th>
                  <th className="pb-2 pr-4 font-medium text-right">Bookings</th>
                  <th className="pb-2 pr-4 font-medium text-right">Base Revenue</th>
                  <th className="pb-2 font-medium text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {quarters.map((q) => (
                  <>
                    {/* Monthly rows */}
                    {q.months.map((m) => (
                      <tr key={m.month} className="border-b border-zinc-50">
                        <td className="py-2.5 pr-4 text-zinc-500 pl-3">{formatMonth(m.month)}</td>
                        <td className="py-2.5 pr-4 text-right text-zinc-500">{m.bookings}</td>
                        <td className="py-2.5 pr-4 text-right text-zinc-500">{fmtEuros(m.base_revenue_cents)}</td>
                        <td className="py-2.5 text-right text-zinc-600">{fmtEuros(m.commission_cents)}</td>
                      </tr>
                    ))}
                    {/* Quarter subtotal */}
                    <tr className="border-b border-zinc-200 bg-zinc-50">
                      <td className="py-2.5 pr-4 font-semibold text-zinc-800">{q.label} Total</td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-zinc-800">{q.bookings}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-zinc-800">{fmtEuros(q.base_revenue_cents)}</td>
                      <td className="py-2.5 text-right font-bold text-[var(--color-primary)]">{fmtEuros(q.commission_cents)}</td>
                    </tr>
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300">
                  <td className="pt-3 pr-4 font-bold text-zinc-900">All time total</td>
                  <td className="pt-3 pr-4 text-right font-bold text-zinc-900">{data.total_bookings}</td>
                  <td className="pt-3 pr-4 text-right font-bold text-zinc-900">
                    {fmtEuros(data.months.reduce((s, m) => s + m.base_revenue_cents, 0))}
                  </td>
                  <td className="pt-3 text-right font-bold text-[var(--color-primary)]">{fmtEuros(data.total_commission_cents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
