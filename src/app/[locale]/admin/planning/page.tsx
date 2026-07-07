'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, ChevronLeft, ChevronRight, List, Plus, X } from 'lucide-react'
import { BookingDetailRow } from '@/components/admin/BookingDetailRow'
import { BookingStatusBadge } from '@/components/admin/BookingStatusBadge'
import { BookingSourceBadge } from '@/components/admin/BookingSourceBadge'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { fmtAdminTime } from '@/lib/admin/format'
import { getWeekStart, addDays, weekDateStrings, formatWeekRangeLabel, amsDateString } from '@/lib/admin/week'
import type { AdminBooking } from '@/lib/admin/types'

// Same background-refresh cadence as the Bookings list — a booking created while
// this page is open (e.g. via the Stripe webhook) shows up on its own.
const REFRESH_INTERVAL_MS = 60_000

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function PlanningPage() {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const { data: bookings, isLoading: loading, error, refresh: fetchBookings } =
    useAdminFetch<AdminBooking[]>('/api/admin/bookings/local', { refreshIntervalMs: REFRESH_INTERVAL_MS })

  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const selectedBooking = bookings?.find(b => b.id === expandedId) ?? null

  const todayStr = useMemo(() => amsDateString(new Date()), [])
  const days = useMemo(() => weekDateStrings(weekStart), [weekStart])

  // Group bookings by booking_date, each day's list sorted by start_time.
  const byDay = useMemo(() => {
    const map = new Map<string, AdminBooking[]>()
    for (const day of days) map.set(day, [])
    for (const b of bookings ?? []) {
      if (!b.booking_date) continue
      const bucket = map.get(b.booking_date)
      if (bucket) bucket.push(b)
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
    }
    return map
  }, [bookings, days])

  const weekTotal = days.reduce((sum, d) => sum + (byDay.get(d)?.length ?? 0), 0)

  return (
    <div className="p-8 max-w-none space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Planning</h1>
          <p className="text-sm text-zinc-500 mt-1">Week view · {weekTotal} booking{weekTotal !== 1 ? 's' : ''} this week</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push(`/${locale}/admin/bookings`)}>
            <List className="w-3.5 h-3.5" />
            List view
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

      {/* Week navigation */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekStart(w => addDays(w, -7))}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart(w => addDays(w, 7))}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 transition-colors"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm font-medium text-zinc-700">{formatWeekRangeLabel(weekStart)}</p>
      </div>

      {/* Loading */}
      {loading && !bookings && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading bookings…
        </div>
      )}

      {/* Week grid — 7 day columns */}
      {bookings && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {days.map((day, i) => {
            const dayBookings = byDay.get(day) ?? []
            const isToday = day === todayStr
            const dateObj = new Date(day + 'T12:00:00')
            return (
              <div
                key={day}
                className={`rounded-lg border overflow-hidden flex flex-col ${
                  isToday ? 'border-indigo-300 bg-indigo-50/30' : 'border-zinc-200 bg-white'
                }`}
              >
                <div className={`px-3 py-2 border-b ${isToday ? 'border-indigo-200 bg-indigo-50' : 'border-zinc-200 bg-zinc-50'}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wider ${isToday ? 'text-indigo-700' : 'text-zinc-500'}`}>
                    {DAY_LABELS[i]}
                  </p>
                  <p className={`text-sm font-medium ${isToday ? 'text-indigo-900' : 'text-zinc-900'}`}>
                    {dateObj.getDate()} {dateObj.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/Amsterdam' })}
                  </p>
                </div>
                <div className="p-2 space-y-2 flex-1 min-h-[80px]">
                  {dayBookings.length === 0 && (
                    <p className="text-xs text-zinc-300 text-center py-4">—</p>
                  )}
                  {dayBookings.map(b => (
                    <button
                      key={b.id}
                      onClick={() => setExpandedId(b.id)}
                      className="w-full text-left rounded-md border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 px-2.5 py-2 text-xs transition-colors"
                    >
                      <p className="font-semibold text-zinc-900">
                        {fmtAdminTime(b.start_time)}
                      </p>
                      <p className="truncate text-zinc-700">
                        {b.listing_title ?? b.tour_item_name ?? '—'}
                      </p>
                      <p className="truncate text-zinc-400">
                        {b.customer_name ?? '—'} · {b.guest_count ?? '—'} guest{b.guest_count !== 1 ? 's' : ''}
                      </p>
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        <BookingStatusBadge status={b.status} />
                        <BookingSourceBadge source={b.booking_source} hideIfWebsite />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail modal — BookingDetailRow is a wide, multi-column layout built for a
          full-width table row; it doesn't fit inline inside a ~250px day column, so
          it opens here instead rather than squeezing (and overlapping) in place. */}
      {selectedBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setExpandedId(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  {selectedBooking.customer_name ?? 'Booking detail'}
                </h2>
                <p className="text-xs text-zinc-400">
                  {selectedBooking.listing_title ?? selectedBooking.tour_item_name} · {fmtAdminTime(selectedBooking.start_time)}
                </p>
              </div>
              <button
                onClick={() => setExpandedId(null)}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <BookingDetailRow
                bookingId={selectedBooking.id}
                bookingUuid={selectedBooking.booking_uuid}
                listingId={selectedBooking.listing_id}
                status={selectedBooking.status}
                stripePaymentIntentId={selectedBooking.stripe_payment_intent_id}
                bookingDate={selectedBooking.booking_date}
                startTime={selectedBooking.start_time}
                listingTitle={selectedBooking.listing_title}
                onRefresh={fetchBookings}
                customerName={selectedBooking.customer_name}
                customerEmail={selectedBooking.customer_email}
                customerPhone={selectedBooking.customer_phone}
                guestNote={selectedBooking.guest_note}
                guestCount={selectedBooking.guest_count}
                baseAmountCents={selectedBooking.base_amount_cents}
                extrasAmountCents={selectedBooking.extras_amount_cents}
                totalVatAmountCents={selectedBooking.total_vat_amount_cents}
                stripeAmount={selectedBooking.stripe_amount}
                depositAmountCents={selectedBooking.deposit_amount_cents}
                extrasSelected={selectedBooking.extras_selected}
                bookingSource={selectedBooking.booking_source}
                campaignName={selectedBooking.campaign_name}
                promoCode={selectedBooking.promo_code}
                discountAmountCents={selectedBooking.discount_amount_cents}
                partnerName={selectedBooking.partner_name}
                category={selectedBooking.category}
                customerTypeName={selectedBooking.customer_type_name}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
