'use client'

import { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

interface Booking {
  id: string
  created_at: string
  booking_uuid: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  tour_item_name: string | null
  listing_title: string | null
  start_time: string | null
  end_time: string | null
  booking_date: string | null
  guest_count: number | null
  category: string | null
  stripe_payment_intent_id: string | null
  stripe_amount: number | null
  status: string | null
  guest_note: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('nl-NL', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam',
  })
}

function fmtAmount(cents: number | null) {
  if (!cents) return '—'
  return `€${(cents / 100).toFixed(0)}`
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, 'success' | 'destructive' | 'secondary'> = {
    confirmed: 'success',
    cancelled: 'destructive',
    booked: 'success',
  }
  return <Badge variant={map[status ?? ''] ?? 'secondary'}>{status ?? '—'}</Badge>
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/bookings/local')
      const json = await res.json()
      if (json.ok) {
        setBookings(json.data)
      } else {
        setError(json.error ?? 'Failed to load bookings')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const confirmed = bookings?.filter(b => b.status === 'confirmed' || b.status === 'booked').length ?? 0
  const totalRevenue = bookings?.filter(b => b.status === 'confirmed' || b.status === 'booked').reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0) ?? 0

  return (
    <div className="p-8 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Bookings</h1>
          <p className="text-sm text-zinc-500 mt-1">From our booking flow · stored in Supabase</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchBookings} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary */}
      {bookings && bookings.length > 0 && (
        <div className="flex items-center gap-6 text-sm text-zinc-500">
          <span><span className="font-semibold text-zinc-900">{bookings.length}</span> total</span>
          <span><span className="font-semibold text-emerald-700">{confirmed}</span> confirmed</span>
          <span className="font-semibold text-zinc-900">{fmtAmount(totalRevenue)}</span>
        </div>
      )}

      {/* Loading */}
      {loading && !bookings && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading bookings…
        </div>
      )}

      {/* Empty state */}
      {!loading && bookings && bookings.length === 0 && (
        <div className="text-sm text-zinc-400 py-8 text-center">
          No bookings yet.
        </div>
      )}

      {/* Table */}
      {bookings && bookings.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Cruise</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Guest</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Guests</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {bookings.map(b => (
                  <tr key={b.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-3 text-zinc-900 whitespace-nowrap">{fmtDate(b.booking_date)}</td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                      {fmtTime(b.start_time)}
                      {b.end_time ? ` – ${fmtTime(b.end_time)}` : ''}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">
                      <p>{b.listing_title ?? b.tour_item_name ?? '—'}</p>
                      {b.category && <p className="text-xs text-zinc-400 capitalize">{b.category}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-900 font-medium">{b.customer_name ?? '—'}</p>
                      {b.customer_email && <p className="text-zinc-400 text-xs">{b.customer_email}</p>}
                      {b.customer_phone && <p className="text-zinc-400 text-xs">{b.customer_phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{b.guest_count ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-900 font-medium whitespace-nowrap">{fmtAmount(b.stripe_amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-3 text-zinc-400 text-xs font-mono">
                      {b.stripe_payment_intent_id
                        ? <span title={b.stripe_payment_intent_id}>{b.stripe_payment_intent_id.slice(0, 10)}…</span>
                        : b.booking_uuid
                        ? <span title={b.booking_uuid}>{b.booking_uuid.slice(0, 8)}…</span>
                        : '—'
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
