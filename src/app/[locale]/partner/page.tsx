'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { fmtEuros } from '@/lib/utils'

interface OverviewData {
  commission_this_month_cents: number
  bookings_this_month: number
  active_campaigns: number
  recent_bookings: {
    date: string
    cruise: string
    guests: number
    commission_cents: number
  }[]
}

export default function PartnerOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/partner/overview')
        const json = await res.json()
        if (json.ok) {
          setData(json.data)
        } else {
          setError(json.error ?? 'Failed to load overview')
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

  const kpis = [
    { label: 'Commission earned (this month)', value: fmtEuros(data.commission_this_month_cents) },
    { label: 'Bookings this month', value: String(data.bookings_this_month) },
    { label: 'Active campaigns', value: String(data.active_campaigns) },
  ]

  return (
    <div className="p-6 sm:p-8 max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-primary)]">Partner Overview</h1>
        <p className="text-sm text-zinc-500 mt-1">Your bookings, campaigns, and commission at a glance.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpis.map(kpi => (
          <div
            key={kpi.label}
            className="bg-white rounded-2xl p-6 border border-zinc-200"
          >
            <p className="text-sm text-zinc-400 mb-2">{kpi.label}</p>
            <p className="text-3xl font-bold text-[var(--color-primary)]">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Recent bookings */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold text-[var(--color-primary)] mb-4">Recent Bookings</h2>

        {data.recent_bookings.length === 0 ? (
          <p className="text-sm text-zinc-400">No bookings yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-400 border-b border-zinc-100">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Cruise</th>
                  <th className="pb-2 pr-4 font-medium">Guests</th>
                  <th className="pb-2 font-medium text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_bookings.map((b, i) => (
                  <tr key={i} className="border-b border-zinc-50 last:border-0">
                    <td className="py-3 pr-4 text-zinc-600">{b.date}</td>
                    <td className="py-3 pr-4 text-zinc-900 font-medium">{b.cruise}</td>
                    <td className="py-3 pr-4 text-zinc-600">{b.guests}</td>
                    <td className="py-3 text-right text-zinc-900 font-medium">
                      {fmtEuros(b.commission_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
