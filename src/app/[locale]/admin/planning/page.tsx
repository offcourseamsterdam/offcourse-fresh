'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, ChevronLeft, ChevronRight, List, Plus, X } from 'lucide-react'
import { BookingDetailRow } from '@/components/admin/BookingDetailRow'
import { BookingStatusBadge } from '@/components/admin/BookingStatusBadge'
import { BookingSourceBadge } from '@/components/admin/BookingSourceBadge'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useBookingsChangedSignal } from '@/hooks/useBookingsChangedSignal'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { fmtAdminTime } from '@/lib/admin/format'
import { getWeekStart, addDays, weekDateStrings, formatWeekRangeLabel, amsDateString } from '@/lib/admin/week'
import { groupBookingsForPlanning, splitGroupsByBoat, extractBoatName, boatAccentClasses, type PlanningGroup } from '@/lib/admin/planning-groups'
import { topPx, blockMinHeightPx, hourMarks, GRID_HEIGHT_PX, RAIL_WIDTH_PX } from '@/lib/admin/planning-time-grid'
import { filterCateringItems } from '@/lib/catering/filter'
import type { AdminBooking } from '@/lib/admin/types'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "14:00 – 16:30", or just "14:00" when there's no meaningful end time. */
function timeRangeLabel(startTime: string | null, endTime: string | null): string {
  const start = fmtAdminTime(startTime)
  const hasRealEnd = endTime && startTime &&
    Math.abs(new Date(endTime).getTime() - new Date(startTime).getTime()) > 60_000
  return hasRealEnd ? `${start} – ${fmtAdminTime(endTime)}` : start
}

/** One departure — the shared header (time, cruise, boat/duration) plus one
 *  row per booking (party) on it. Reused both in the plain day list and
 *  inside a per-boat sub-column. */
function DepartureBlock({ group, onSelectBooking }: { group: PlanningGroup; onSelectBooking: (id: string) => void }) {
  const first = group.bookings[0]
  const isMulti = group.bookings.length > 1
  return (
    <div className="rounded-md border border-zinc-200 bg-white h-full overflow-hidden shadow-sm">
      <div className="px-2.5 pt-2 pb-1.5 border-b border-zinc-100 bg-zinc-50/60">
        <p className="font-semibold text-zinc-900 text-xs">
          {timeRangeLabel(first.start_time, first.end_time)}
        </p>
        <p className="truncate text-zinc-700 text-xs">
          {first.listing_title ?? first.tour_item_name ?? '—'}
        </p>
        {first.customer_type_name && (
          <p className="truncate text-zinc-400 text-[11px]">{first.customer_type_name}</p>
        )}
        {isMulti && (
          <p className="text-[11px] font-medium text-indigo-600 mt-0.5">
            {group.bookings.length} bookings · {group.totalGuestCount} guests total
          </p>
        )}
      </div>
      <div className="divide-y divide-zinc-100">
        {group.bookings.map(b => {
          const cateringItems = filterCateringItems(b.extras_selected ?? [])
          const showStatus = b.status !== 'confirmed' && b.status !== 'booked'
          return (
            <button
              key={b.id}
              onClick={() => onSelectBooking(b.id)}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-zinc-50 transition-colors"
            >
              <p className="text-zinc-900 font-medium truncate">
                {b.customer_name ?? '—'} · {b.guest_count ?? '—'} guest{b.guest_count !== 1 ? 's' : ''}
              </p>
              {cateringItems.length > 0 && (
                <p className="truncate text-zinc-500">
                  🍽️ {cateringItems.map(i => i.name).join(', ')}
                </p>
              )}
              {b.guest_note && (
                <p className="truncate text-zinc-400 italic">&ldquo;{b.guest_note}&rdquo;</p>
              )}
              <div className="mt-1 flex items-center gap-1 flex-wrap">
                <BookingSourceBadge source={b.booking_source} />
                {showStatus && <BookingStatusBadge status={b.status} />}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Hour gridlines for one time-grid column — a background layer of thin
 * horizontal lines, one per hour from 09:00 to 00:00. Purely decorative
 * (z-0, no pointer events), sits behind the positioned departure blocks.
 */
function GridLines() {
  return (
    <>
      {hourMarks().map(m => (
        <div
          key={m.hour}
          className="absolute left-0 right-0 border-t border-zinc-100"
          style={{ top: m.topPx }}
        />
      ))}
    </>
  )
}

/**
 * One time-axis column (a whole day when it isn't split by boat, or one boat
 * sub-column when it is). Fixed height spanning the full 09:00–00:00 window;
 * each departure is positioned by its TOP edge only (real clock time) — a
 * small colored dot + left border mark that true edge, while the block's
 * body renders at its natural content height (never compressed for
 * readability) and can extend past its nominal time slot if it needs to.
 * Hovering brings a block to the front, for the rare case of two departures
 * close enough together to visually overlap.
 *
 * `boatLabel` (when a day is split by boat) renders as an absolutely
 * positioned overlay INSIDE this container rather than a block above it —
 * every column's grid must start at the exact same offset regardless of
 * whether it has a label, or its hours would drift out of sync with the
 * shared hour rail and every other (unlabeled) day column.
 */
function TimeGridColumn({ groups, onSelectBooking, boatLabel }: { groups: PlanningGroup[]; onSelectBooking: (id: string) => void; boatLabel?: string }) {
  return (
    <div className="relative" style={{ height: GRID_HEIGHT_PX }}>
      <GridLines />
      {boatLabel && (
        <p className="absolute top-0.5 left-1 z-20 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-white/90 px-1 rounded pointer-events-none">
          {boatLabel}
        </p>
      )}
      {groups.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-zinc-300">—</p>
      )}
      {groups.map(group => {
        const first = group.bookings[0]
        const boat = extractBoatName(first.customer_type_name) ?? 'Other'
        const accent = boatAccentClasses(boat)
        return (
          <div
            key={group.key}
            className="absolute left-1.5 right-1 z-10 hover:z-20 transition-shadow"
            style={{ top: topPx(first.start_time), minHeight: blockMinHeightPx(first.start_time, first.end_time) }}
          >
            <div className={`h-full border-l-2 pl-1 ${accent.border}`}>
              <DepartureBlock group={group} onSelectBooking={onSelectBooking} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function PlanningPage() {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const { data: bookings, isLoading: loading, error, refresh: fetchBookings } =
    useAdminFetch<AdminBooking[]>('/api/admin/bookings/local')
  // Event-based, not polling — see notify-bookings-changed.ts for every trigger point.
  useBookingsChangedSignal(fetchBookings)

  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const selectedBooking = bookings?.find(b => b.id === expandedId) ?? null

  const todayStr = useMemo(() => amsDateString(new Date()), [])
  const days = useMemo(() => weekDateStrings(weekStart), [weekStart])

  // Group bookings by booking_date, then within each day collapse same-slot
  // bookings (same time + listing + category + customer type) into one block —
  // a shared cruise sold to several separate parties is one departure, not N
  // unrelated cards. Each day's groups sorted by start_time (also the sort
  // order the time-grid positions them in, top to bottom).
  const byDay = useMemo(() => {
    const map = new Map<string, AdminBooking[]>()
    for (const day of days) map.set(day, [])
    for (const b of bookings ?? []) {
      if (!b.booking_date) continue
      const bucket = map.get(b.booking_date)
      if (bucket) bucket.push(b)
    }
    const grouped = new Map<string, PlanningGroup[]>()
    for (const [day, dayBookings] of map) {
      const groups = groupBookingsForPlanning(dayBookings)
      groups.sort((a, b) => (a.bookings[0].start_time ?? '').localeCompare(b.bookings[0].start_time ?? ''))
      grouped.set(day, groups)
    }
    return grouped
  }, [bookings, days])

  const weekTotal = days.reduce(
    (sum, d) => sum + (byDay.get(d)?.reduce((s, g) => s + g.bookings.length, 0) ?? 0),
    0,
  )

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

      {/* Week grid — a shared 09:00–00:00 hour rail on the left (one for the
          whole week, not repeated per day/boat column), then 7 day columns.
          Flex, not CSS grid: a day running two boats gets proportionally more
          width (flexGrow = boat count) instead of squeezing a second boat
          column into a fixed-width cell where it'd silently overflow off-screen. */}
      {bookings && (
        <div className="flex gap-2">
          {/* Hour rail */}
          <div className="w-10 shrink-0 relative" style={{ height: GRID_HEIGHT_PX + 45 /* header row offset */ }}>
            {hourMarks().map(m => (
              <div
                key={m.hour}
                className="absolute right-1.5 text-[10px] text-zinc-400 -translate-y-1/2"
                style={{ top: m.topPx + 45, width: RAIL_WIDTH_PX }}
              >
                {m.label}
              </div>
            ))}
          </div>

          <div className="flex flex-col lg:flex-row gap-3 items-stretch flex-1">
            {days.map((day, i) => {
              const dayGroups = byDay.get(day) ?? []
              const boatColumns = splitGroupsByBoat(dayGroups)
              const isToday = day === todayStr
              const dateObj = new Date(day + 'T12:00:00')
              const isSplit = boatColumns.length > 1
              return (
                <div
                  key={day}
                  style={{ flexGrow: Math.max(1, boatColumns.length), flexBasis: 0 }}
                  className={`rounded-lg border flex flex-col lg:min-w-[150px] ${
                    isToday ? 'border-indigo-300 bg-indigo-50/30' : 'border-zinc-200 bg-white'
                  }`}
                >
                  <div className={`px-3 py-2 border-b rounded-t-lg ${isToday ? 'border-indigo-200 bg-indigo-50' : 'border-zinc-200 bg-zinc-50'}`}>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${isToday ? 'text-indigo-700' : 'text-zinc-500'}`}>
                      {DAY_LABELS[i]}
                    </p>
                    <p className={`text-sm font-medium ${isToday ? 'text-indigo-900' : 'text-zinc-900'}`}>
                      {dateObj.getDate()} {dateObj.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/Amsterdam' })}
                    </p>
                  </div>
                  <div className="p-2">
                    {!isSplit && (
                      <TimeGridColumn groups={dayGroups} onSelectBooking={setExpandedId} />
                    )}
                    {isSplit && (
                      <div className="flex gap-2 divide-x divide-zinc-100">
                        {boatColumns.map(col => (
                          <div key={col.boat} className="flex-1 min-w-0 pl-2 first:pl-0">
                            <TimeGridColumn groups={col.groups} onSelectBooking={setExpandedId} boatLabel={col.boat} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
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
                  {selectedBooking.listing_title ?? selectedBooking.tour_item_name} · {timeRangeLabel(selectedBooking.start_time, selectedBooking.end_time)}
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
