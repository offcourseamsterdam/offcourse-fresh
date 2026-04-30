'use client'

import { useState, Fragment } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { BookingDetailRow } from '@/components/admin/BookingDetailRow'
import { BookingStatusBadge } from '@/components/admin/BookingStatusBadge'
import { BookingSourceBadge } from '@/components/admin/BookingSourceBadge'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { fmtAdminDate, fmtAdminTime, fmtAdminAmountRounded } from '@/lib/admin/format'
import type { AdminBooking } from '@/lib/admin/types'

type SourceFilter = 'all' | 'website' | 'internal'



// ── Page ───────────────────────────────────────────────────────────────────

export default function BookingsPage() {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const { data: bookings, isLoading: loading, error, refresh: fetchBookings } =
    useAdminFetch<AdminBooking[]>('/api/admin/bookings/local')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  function toggleRow(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const filteredBookings = bookings?.filter(b => {
    if (sourceFilter === 'all') return true
    if (sourceFilter === 'website') return !b.booking_source || b.booking_source === 'website'
    if (sourceFilter === 'internal') return b.booking_source && b.booking_source !== 'website'
    return true
  }) ?? []

  const confirmed = bookings?.filter(b => b.status === 'confirmed' || b.status === 'booked').length ?? 0
  const totalRevenue = bookings
    ?.filter(b => (b.status === 'confirmed' || b.status === 'booked') && b.booking_source === 'website')
    .reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0) ?? 0

  return (
    <div className="p-8 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Bookings</h1>
          <p className="text-sm text-zinc-500 mt-1">From our booking flow · stored in Supabase</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchBookings} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => router.push(`/${locale}/admin/fareharbor`)}>
            <Plus className="w-3.5 h-3.5" />
            New booking
          </Button>
        </div>
      </div>

      <AdminErrorBanner error={error} />

      {/* Summary + filter */}
      {bookings && bookings.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <span><span className="font-semibold text-zinc-900">{bookings.length}</span> total</span>
            <span><span className="font-semibold text-emerald-700">{confirmed}</span> confirmed</span>
            {/* Rounded for at-a-glance; detail rows use 2-decimal fmtAdminAmount */}
            <span className="font-semibold text-zinc-900">{fmtAdminAmountRounded(totalRevenue)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(['all', 'website', 'internal'] as SourceFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  sourceFilter === f
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                }`}
              >
                {f === 'all' ? 'All' : f === 'website' ? 'Regular' : 'Internal'}
              </button>
            ))}
          </div>
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
      {filteredBookings.length > 0 && (
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ref</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {filteredBookings.map(b => (
                  <Fragment key={b.id}>
                    <tr
                      className="hover:bg-zinc-50 transition-colors cursor-pointer"
                      onClick={() => toggleRow(b.id)}
                    >
                      <td className="px-4 py-3 text-zinc-900 whitespace-nowrap">{fmtAdminDate(b.booking_date)}</td>
                      <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                        {fmtAdminTime(b.start_time)}
                        {b.end_time ? ` – ${fmtAdminTime(b.end_time)}` : ''}
                      </td>
                      <td className="px-4 py-3 text-zinc-900">
                        <p>{b.listing_title ?? b.tour_item_name ?? '—'}</p>
                        {b.category && <p className="text-xs text-zinc-400 capitalize">{b.category}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-zinc-900 font-medium">{b.customer_name ?? '—'}</p>
                        {b.customer_email && <p className="text-zinc-400 text-xs">{b.customer_email}</p>}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {b.category === 'shared'
                          ? <span title={b.tour_item_name ?? ''}>{b.guest_count ?? '—'} {b.tour_item_name ? `(${b.tour_item_name})` : ''}</span>
                          : (b.guest_count ?? '—')
                        }
                      </td>
                      <td className="px-4 py-3 text-zinc-900 font-medium whitespace-nowrap">
                        {b.booking_source && b.booking_source !== 'website'
                          ? (b.deposit_amount_cents != null ? `€${(b.deposit_amount_cents / 100).toFixed(0)}` : '—')
                          : fmtAdminAmountRounded(b.stripe_amount)
                        }
                      </td>
                      <td className="px-4 py-3"><BookingSourceBadge source={b.booking_source} /></td>
                      <td className="px-4 py-3"><BookingStatusBadge status={b.status} /></td>
                      <td className="px-4 py-3 text-zinc-400 text-xs font-mono">
                        {b.stripe_payment_intent_id
                          ? <span title={b.stripe_payment_intent_id}>{b.stripe_payment_intent_id.slice(0, 10)}…</span>
                          : b.booking_uuid
                          ? <span title={b.booking_uuid}>{b.booking_uuid.slice(0, 8)}…</span>
                          : '—'
                        }
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {expanded[b.id]
                          ? <ChevronUp className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />
                        }
                      </td>
                    </tr>
                    {expanded[b.id] && (
                      <tr>
                        <td colSpan={10} className="p-0">
                          <BookingDetailRow
                            bookingId={b.id}
                            bookingUuid={b.booking_uuid}
                            listingId={b.listing_id}
                            status={b.status}
                            stripePaymentIntentId={b.stripe_payment_intent_id}
                            bookingDate={b.booking_date}
                            startTime={b.start_time}
                            listingTitle={b.listing_title}
                            onRefresh={fetchBookings}
                            customerName={b.customer_name}
                            customerEmail={b.customer_email}
                            customerPhone={b.customer_phone}
                            guestNote={b.guest_note}
                            baseAmountCents={b.base_amount_cents}
                            extrasAmountCents={b.extras_amount_cents}
                            totalVatAmountCents={b.total_vat_amount_cents}
                            stripeAmount={b.stripe_amount}
                            depositAmountCents={b.deposit_amount_cents}
                            extrasSelected={b.extras_selected}
                            bookingSource={b.booking_source}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty filtered state */}
      {!loading && bookings && bookings.length > 0 && filteredBookings.length === 0 && (
        <div className="text-sm text-zinc-400 py-8 text-center">
          No {sourceFilter === 'internal' ? 'internal' : 'regular'} bookings yet.
        </div>
      )}
    </div>
  )
}
