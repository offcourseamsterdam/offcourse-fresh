'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { fmtEuros } from '@/lib/utils'

type PeriodKey = '30d' | '90d' | 'year' | 'all'

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
]

function getDateRange(key: PeriodKey): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)

  switch (key) {
    case '30d': {
      const d = new Date(now)
      d.setDate(d.getDate() - 30)
      return { from: d.toISOString().slice(0, 10), to }
    }
    case '90d': {
      const d = new Date(now)
      d.setDate(d.getDate() - 90)
      return { from: d.toISOString().slice(0, 10), to }
    }
    case 'year': {
      return { from: `${now.getFullYear()}-01-01`, to }
    }
    case 'all': {
      return { from: '2020-01-01', to }
    }
  }
}

interface Booking {
  date: string
  cruise: string
  time: string
  guests: number
  base_price_cents: number
  commission_cents: number
}

export default function PartnerBookingsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBookings = useCallback(async (key: PeriodKey) => {
    setLoading(true)
    setError(null)
    const { from, to } = getDateRange(key)
    try {
      const res = await fetch(`/api/partner/bookings?from=${from}&to=${to}`)
      const json = await res.json()
      if (json.ok) {
        setBookings(json.data)
      } else {
        setError(json.error ?? 'Failed to load bookings')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBookings(period)
  }, [period, fetchBookings])

  return (
    <div className="p-6 sm:p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-primary)]">Bookings</h1>
        <p className="text-sm text-zinc-500 mt-1">All bookings made through your campaign links.</p>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              period === p.key
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-zinc-400 py-8 text-center">
            No bookings yet &mdash; share your campaign links to start earning commission.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-400 border-b border-zinc-100">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Cruise</th>
                  <th className="pb-2 pr-4 font-medium">Time</th>
                  <th className="pb-2 pr-4 font-medium">Guests</th>
                  <th className="pb-2 pr-4 font-medium text-right">Base Price</th>
                  <th className="pb-2 font-medium text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b, i) => (
                  <tr key={i} className="border-b border-zinc-50 last:border-0">
                    <td className="py-3 pr-4 text-zinc-600">{b.date}</td>
                    <td className="py-3 pr-4 text-zinc-900 font-medium">{b.cruise}</td>
                    <td className="py-3 pr-4 text-zinc-600">{b.time}</td>
                    <td className="py-3 pr-4 text-zinc-600">{b.guests}</td>
                    <td className="py-3 pr-4 text-right text-zinc-600">{fmtEuros(b.base_price_cents)}</td>
                    <td className="py-3 text-right text-zinc-900 font-medium">{fmtEuros(b.commission_cents)}</td>
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
