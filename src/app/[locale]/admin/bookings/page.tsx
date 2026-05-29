'use client'

import { useState, Fragment } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, ChevronDown, ChevronUp, Plus, ArrowUp, ArrowDown } from 'lucide-react'
import { BookingDetailRow } from '@/components/admin/BookingDetailRow'
import { BookingStatusBadge } from '@/components/admin/BookingStatusBadge'
import { BookingSourceBadge } from '@/components/admin/BookingSourceBadge'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { fmtAdminDate, fmtAdminTime, fmtAdminAmountRounded, fmtAdminDateCreated } from '@/lib/admin/format'
import { dateCreatedThreshold, type DateCreatedFilter } from '@/lib/admin/date-filter'
import type { AdminBooking } from '@/lib/admin/types'

type SourceFilter = 'all' | 'website' | 'internal'
type SortField = 'booking_date' | 'created_at'
type SortDir = 'asc' | 'desc'

// ── Page ───────────────────────────────────────────────────────────────────

export default function BookingsPage() {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const { data: bookings, isLoading: loading, error, refresh: fetchBookings } =
    useAdminFetch<AdminBooking[]>('/api/admin/bookings/local')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [dateCreatedFilter, setDateCreatedFilter] = useState<DateCreatedFilter>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function toggleRow(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function handleSortClick(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  // Filter
  const threshold = dateCreatedThreshold(dateCreatedFilter)
  const filtered = (bookings ?? []).filter(b => {
    if (sourceFilter === 'website' && b.booking_source && b.booking_source !== 'website') return false
    if (sourceFilter === 'internal' && (!b.booking_source || b.booking_source === 'website')) return false
    if (threshold && b.created_at && new Date(b.created_at) < threshold) return false
    return true
  })

  // Sort
  const filteredBookings = [...filtered].sort((a, b) => {
    const aVal = sortField === 'booking_date' ? (a.booking_date ?? '') : (a.created_at ?? '')
    const bVal = sortField === 'booking_date' ? (b.booking_date ?? '') : (b.created_at ?? '')
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const confirmed = bookings?.filter(b => b.status === 'confirmed' || b.status === 'booked').length ?? 0
  const totalRevenue = bookings
    ?.filter(b => (b.status === 'confirmed' || b.status === 'booked') && b.booking_source === 'website')
    .reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0) ?? 0

  const DATE_CREATED_LABELS: Record<DateCreatedFilter, string> = {
    all: 'All time',
    today: 'Today',
    week: 'This week',
    month: 'This month',
    quarter: 'This quarter',
    year: 'This year',
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowDown className="w-3 h-3 opacity-30" />
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-zinc-900" />
      : <ArrowDown className="w-3 h-3 text-zinc-900" />
  }

  return (
    <div className="p-8 max-w-none space-y-6">
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

      {/* Summary + filters */}
      {bookings && bookings.length > 0 && (
        <div className="space-y-3">
          {/* Stats row */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-6 text-sm text-zinc-500">
              <span><span className="font-semibold text-zinc-900">{bookings.length}</span> total</span>
              <span><span className="font-semibold text-emerald-700">{confirmed}</span> confirmed</span>
              <span className="font-semibold text-zinc-900">{fmtAdminAmountRounded(totalRevenue)}</span>
            </div>
            {/* Source filter */}
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

          {/* Date created filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-zinc-400 mr-1">Created:</span>
            {(Object.keys(DATE_CREATED_LABELS) as DateCreatedFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setDateCreatedFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  dateCreatedFilter === f
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                }`}
              >
                {DATE_CREATED_LABELS[f]}
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[110px]">
                    <button
                      onClick={() => handleSortClick('booking_date')}
                      className="flex items-center gap-1 hover:text-zinc-900 transition-colors"
                    >
                      Date <SortIcon field="booking_date" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[120px]">
                    <button
                      onClick={() => handleSortClick('created_at')}
                      className="flex items-center gap-1 hover:text-zinc-900 transition-colors"
                    >
                      Created <SortIcon field="created_at" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[110px]">Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[200px]">Cruise</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[180px]">Guest</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-16">Guests</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-24">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-24">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-28">Status</th>
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
                      <td className="px-4 py-3 text-zinc-500 whitespace-nowrap text-xs">{fmtAdminDateCreated(b.created_at)}</td>
                      <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                        {fmtAdminTime(b.start_time)}
                        {b.end_time && b.start_time &&
                          Math.abs(new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) > 60_000
                          ? ` – ${fmtAdminTime(b.end_time)}`
                          : ''
                        }
                      </td>
                      <td className="px-4 py-3 text-zinc-900">
                        <p>{b.listing_title ?? b.tour_item_name ?? '—'}</p>
                        {b.customer_type_name
                          ? <p className="text-xs text-zinc-400">{b.customer_type_name}</p>
                          : b.category && <p className="text-xs text-zinc-400 capitalize">{b.category}</p>
                        }
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
                      <td className="px-4 py-3">
                        <BookingSourceBadge source={b.booking_source} />
                        {b.partner_name && (
                          <p className="text-xs text-zinc-400 mt-0.5">{b.partner_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3"><BookingStatusBadge status={b.status} /></td>
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
                            guestCount={b.guest_count}
                            baseAmountCents={b.base_amount_cents}
                            extrasAmountCents={b.extras_amount_cents}
                            totalVatAmountCents={b.total_vat_amount_cents}
                            stripeAmount={b.stripe_amount}
                            depositAmountCents={b.deposit_amount_cents}
                            extrasSelected={b.extras_selected}
                            bookingSource={b.booking_source}
                            campaignName={b.campaign_name}
                            promoCode={b.promo_code}
                            discountAmountCents={b.discount_amount_cents}
                            partnerName={b.partner_name}
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
          No bookings match the current filters.
        </div>
      )}
    </div>
  )
}
