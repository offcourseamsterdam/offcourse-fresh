'use client'

import { useState, Fragment } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, ChevronDown, ChevronUp, Plus, ArrowUp, ArrowDown, Search, X, CalendarRange, FileText, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import { BookingDetailRow } from '@/components/admin/BookingDetailRow'
import { BookingStatusBadge } from '@/components/admin/BookingStatusBadge'
import { BookingSourceBadge } from '@/components/admin/BookingSourceBadge'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useBookingsChangedSignal } from '@/hooks/useBookingsChangedSignal'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { fmtAdminDate, fmtAdminTime, fmtAdminAmountRounded, fmtAdminDateCreated } from '@/lib/admin/format'
import { dateCreatedThreshold, type DateCreatedFilter } from '@/lib/admin/date-filter'
import { matchesBookingSearch } from '@/lib/admin/booking-search'
import type { AdminBooking } from '@/lib/admin/types'

type SourceFilter = 'all' | 'website' | 'internal' | 'open_invoices'
type SortField = 'booking_date' | 'created_at'
type SortDir = 'asc' | 'desc'

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (sortField !== field) return <ArrowDown className="w-3 h-3 opacity-30" />
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 text-zinc-900" />
    : <ArrowDown className="w-3 h-3 text-zinc-900" />
}

function InvoiceStatusIndicator({ booking }: { booking: AdminBooking }) {
  const isInvoiceBooking = 
    booking.booking_source === 'stripe_invoice' || 
    booking.booking_source === 'invoice_later' || 
    Boolean(booking.stripe_invoice_id)

  if (!isInvoiceBooking || booking.status === 'cancelled') return null

  const todayStr = new Date().toISOString().split('T')[0]
  const today = new Date(todayStr)

  // 1. Paid
  if (booking.payment_status === 'paid') {
    return (
      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 mt-1 whitespace-nowrap">
        <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
        <span>Factuur voldaan</span>
      </div>
    )
  }

  // 2. Sent and open
  if (booking.stripe_invoice_id || booking.payment_status === 'stripe_invoice_sent') {
    let diffDays: number | null = null
    if (booking.invoice_due_date) {
      const dueDate = new Date(booking.invoice_due_date)
      diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    }

    if (diffDays != null && diffDays < 0) {
      return (
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 mt-1 whitespace-nowrap">
          <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />
          <span>Factuur open · {Math.abs(diffDays)}d verlopen</span>
        </div>
      )
    }

    if (diffDays != null && diffDays === 0) {
      return (
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 mt-1 whitespace-nowrap">
          <Clock className="w-3 h-3 text-amber-600 shrink-0" />
          <span>Factuur open · Vervalt vandaag</span>
        </div>
      )
    }

    return (
      <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-900 border border-amber-300 mt-1 whitespace-nowrap">
        <Clock className="w-3 h-3 text-amber-600 shrink-0" />
        <span>Factuur open{diffDays != null ? ` · nog ${diffDays}d` : ''}</span>
      </div>
    )
  }

  // 3. Not sent yet: countdown to when it will be sent
  if (booking.booking_date) {
    const tourDate = new Date(booking.booking_date)
    const tourDiffDays = Math.ceil((tourDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (tourDiffDays > 0) {
      return (
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-700 border border-zinc-300 mt-1 whitespace-nowrap" title="Factuur wordt automatisch verzonden na de tour">
          <Clock className="w-3 h-3 text-zinc-400 shrink-0" />
          <span>Versturen over {tourDiffDays}d (na tour)</span>
        </div>
      )
    } else {
      return (
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 mt-1 whitespace-nowrap">
          <Clock className="w-3 h-3 text-blue-600 shrink-0" />
          <span>Factuur klaar om te versturen</span>
        </div>
      )
    }
  }

  return (
    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-100 text-zinc-600 mt-1 whitespace-nowrap">
      <span>Factuur nog niet verzonden</span>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function BookingsPage() {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const { data: bookings, isLoading: loading, error, refresh: fetchBookings } =
    useAdminFetch<AdminBooking[]>('/api/admin/bookings/local')
  // Event-based, not polling: the server pings this channel the moment a booking
  // is actually written (webhook, admin action, cron sweep) — see
  // notify-bookings-changed.ts for every trigger point.
  useBookingsChangedSignal(fetchBookings)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [reconciliationOnly, setReconciliationOnly] = useState(false)
  const [dateCreatedFilter, setDateCreatedFilter] = useState<DateCreatedFilter>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch] = useState('')

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

  const openInvoicesCount = bookings?.filter(b => b.payment_status === 'stripe_invoice_sent').length ?? 0

  // Filter
  const threshold = dateCreatedThreshold(dateCreatedFilter)
  const filtered = (bookings ?? []).filter(b => {
    if (sourceFilter === 'website' && b.booking_source && b.booking_source !== 'website') return false
    if (sourceFilter === 'internal' && (!b.booking_source || b.booking_source === 'website')) return false
    if (reconciliationOnly && b.payment_status !== 'needs_reconciliation') return false
    if (sourceFilter === 'open_invoices' && b.payment_status !== 'stripe_invoice_sent') return false
    if (threshold && b.created_at && new Date(b.created_at) < threshold) return false
    if (!matchesBookingSearch(b, search)) return false
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
    ?.filter(b => (b.status === 'confirmed' || b.status === 'booked') && (b.booking_source === 'website' || b.booking_source === 'stripe_invoice'))
    .reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0) ?? 0
  const needsReconciliationCount = bookings?.filter(b => b.payment_status === 'needs_reconciliation').length ?? 0

  const DATE_CREATED_LABELS: Record<DateCreatedFilter, string> = {
    all: 'All time',
    today: 'Today',
    week: 'This week',
    month: 'This month',
    quarter: 'This quarter',
    year: 'This year',
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
          <Button variant="outline" size="sm" onClick={() => router.push(`/${locale}/admin/planning`)}>
            <CalendarRange className="w-3.5 h-3.5" />
            Week view
          </Button>
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
              {needsReconciliationCount > 0 && (
                <span><span className="font-semibold text-amber-700">{needsReconciliationCount}</span> need reconciliation</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, email, cruise…"
                  className="pl-8 pr-7 py-1.5 rounded-lg text-xs bg-zinc-100 border border-transparent focus:bg-white focus:border-zinc-300 focus:outline-none transition-colors w-56"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* Source filter */}
              <div className="flex items-center gap-1.5">
                {(['all', 'website', 'internal', 'open_invoices'] as SourceFilter[]).map(f => {
                  const isActive = sourceFilter === f
                  if (f === 'open_invoices') {
                    return (
                      <button
                        key={f}
                        onClick={() => setSourceFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-amber-600 text-white shadow-xs'
                            : openInvoicesCount > 0
                            ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                            : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Open facturen</span>
                        {openInvoicesCount > 0 && (
                          <span className={`px-1.5 py-0.2 text-[10px] font-bold rounded-full ${
                            isActive ? 'bg-white text-amber-700' : 'bg-amber-200 text-amber-900'
                          }`}>
                            {openInvoicesCount}
                          </span>
                        )}
                      </button>
                    )
                  }
                  return (
                    <button
                      key={f}
                      onClick={() => setSourceFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-zinc-900 text-white'
                          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                      }`}
                    >
                      {f === 'all' ? 'All' : f === 'website' ? 'Regular' : 'Internal'}
                    </button>
                  )
                })}
                {needsReconciliationCount > 0 && (
                  <button
                    onClick={() => setReconciliationOnly(v => !v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      reconciliationOnly
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    }`}
                  >
                    Needs reconciliation ({needsReconciliationCount})
                  </button>
                )}
              </div>
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
                      Date <SortIcon field="booking_date" sortField={sortField} sortDir={sortDir} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[120px]">
                    <button
                      onClick={() => handleSortClick('created_at')}
                      className="flex items-center gap-1 hover:text-zinc-900 transition-colors"
                    >
                      Created <SortIcon field="created_at" sortField={sortField} sortDir={sortDir} />
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
                        {b.guest_count ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-zinc-900 font-medium whitespace-nowrap">
                        {b.booking_source === 'website' || b.booking_source === 'payment_link' || b.booking_source === 'phone_walkin' || b.booking_source === 'stripe_invoice' || b.booking_source === 'stripe_recovery' || !b.booking_source
                          ? fmtAdminAmountRounded(b.stripe_amount)
                          : (b.deposit_amount_cents != null ? `€${(b.deposit_amount_cents / 100).toFixed(0)}` : '—')
                        }
                      </td>
                      <td className="px-4 py-3">
                        <BookingSourceBadge source={b.booking_source} />
                        {b.partner_name && (
                          <p className="text-xs text-zinc-400 mt-0.5">{b.partner_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-0.5">
                          <BookingStatusBadge status={b.status} />
                          <InvoiceStatusIndicator booking={b} />
                          {b.payment_status === 'needs_reconciliation' && (
                            <span
                              title="Imported from the 2026 FareHarbor reconciliation — guest identity or amount unconfirmed. See the note below."
                              className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                            >
                              needs reconciliation
                            </span>
                          )}
                        </div>
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
                            paymentStatus={b.payment_status}
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
                            trafficSource={b.traffic_source}
                            trafficDetail={b.traffic_detail}
                            campaignName={b.campaign_name}
                            promoCode={b.promo_code}
                            discountAmountCents={b.discount_amount_cents}
                            partnerName={b.partner_name}
                            category={b.category}
                            customerTypeName={b.customer_type_name}
                            noRescheduleAsk={b.no_reschedule_ask ?? false}
                            noRescheduleReason={b.no_reschedule_reason}
                            stripeInvoiceId={b.stripe_invoice_id}
                            stripeInvoiceUrl={b.stripe_invoice_url}
                            companyName={b.company_name}
                            companyKvk={b.company_kvk}
                            companyVat={b.company_vat}
                            companyAddress={b.company_address}
                            invoiceDueDate={b.invoice_due_date}
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
