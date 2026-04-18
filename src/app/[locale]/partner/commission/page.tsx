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

export default function PartnerCommissionPage() {
  const [data, setData] = useState<CommissionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/partner/commission')
        const json = await res.json()
        if (json.ok) {
          setData(json.data)
        } else {
          setError(json.error ?? 'Failed to load commission data')
        }
      } catch {
        setError('Network error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 sm:p-8">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  if (!data) return null

  // Calculate totals for the table footer
  const totalBookings = data.months.reduce((sum, m) => sum + m.bookings, 0)
  const totalRevenue = data.months.reduce((sum, m) => sum + m.base_revenue_cents, 0)
  const totalCommission = data.months.reduce((sum, m) => sum + m.commission_cents, 0)

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

      {/* Monthly breakdown */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold text-[var(--color-primary)] mb-4">Monthly Breakdown</h2>

        {data.months.length === 0 ? (
          <p className="text-sm text-zinc-400">No commission data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-400 border-b border-zinc-100">
                  <th className="pb-2 pr-4 font-medium">Month</th>
                  <th className="pb-2 pr-4 font-medium text-right">Bookings</th>
                  <th className="pb-2 pr-4 font-medium text-right">Base Revenue</th>
                  <th className="pb-2 font-medium text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((m, i) => (
                  <tr key={i} className="border-b border-zinc-50 last:border-0">
                    <td className="py-3 pr-4 text-zinc-900 font-medium">{m.month}</td>
                    <td className="py-3 pr-4 text-right text-zinc-600">{m.bookings}</td>
                    <td className="py-3 pr-4 text-right text-zinc-600">{fmtEuros(m.base_revenue_cents)}</td>
                    <td className="py-3 text-right text-zinc-900 font-medium">{fmtEuros(m.commission_cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200">
                  <td className="pt-3 pr-4 text-zinc-900 font-bold">Total</td>
                  <td className="pt-3 pr-4 text-right text-zinc-900 font-bold">{totalBookings}</td>
                  <td className="pt-3 pr-4 text-right text-zinc-900 font-bold">{fmtEuros(totalRevenue)}</td>
                  <td className="pt-3 text-right text-zinc-900 font-bold">{fmtEuros(totalCommission)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
