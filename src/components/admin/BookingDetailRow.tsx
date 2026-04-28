'use client'

import { useState } from 'react'
import { Pencil, Ban, CalendarDays } from 'lucide-react'
import { EXTRAS_CATEGORIES } from '@/lib/constants'
import { fmtAdminAmount } from '@/lib/admin/format'
import { BookingSourceBadge } from '@/components/admin/BookingSourceBadge'
import type { BookingSource } from '@/lib/constants'
import { CancelBookingModal } from '@/components/admin/booking-actions/CancelBookingModal'
import { EditBookingModal } from '@/components/admin/booking-actions/EditBookingModal'
import { RescheduleBookingModal } from '@/components/admin/booking-actions/RescheduleBookingModal'

// ── Types ──────────────────────────────────────────────────────────────────

interface ExtraLineItem {
  name: string
  amount_cents: number
  category?: string
}

interface BookingDetailRowProps {
  bookingId: string
  bookingUuid: string | null
  listingId: string | null
  status: string | null
  stripePaymentIntentId: string | null
  bookingDate: string | null
  startTime: string | null
  listingTitle: string | null
  onRefresh: () => void
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  guestNote: string | null
  baseAmountCents: number | null
  extrasAmountCents: number | null
  totalVatAmountCents: number | null
  stripeAmount: number | null
  depositAmountCents: number | null
  extrasSelected: ExtraLineItem[] | null
  bookingSource: string | null
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────────

export function BookingDetailRow({
  bookingId,
  bookingUuid,
  listingId,
  status,
  stripePaymentIntentId: _stripePaymentIntentId,
  bookingDate,
  startTime,
  listingTitle,
  onRefresh,
  customerName,
  customerEmail,
  customerPhone,
  guestNote,
  baseAmountCents,
  extrasAmountCents,
  totalVatAmountCents,
  stripeAmount,
  depositAmountCents,
  extrasSelected,
  bookingSource,
  className = '',
}: BookingDetailRowProps) {
  const [showCancel, setShowCancel] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showReschedule, setShowReschedule] = useState(false)

  const isCancelled = status === 'cancelled'
  const isInternal = bookingSource && bookingSource !== 'website'
  const isWebsiteBooking = !bookingSource || bookingSource === 'website'
  const extras = (extrasSelected ?? []) as ExtraLineItem[]

  // Group extras by category
  const byCategory = EXTRAS_CATEGORIES.reduce<Record<string, ExtraLineItem[]>>((acc, cat) => {
    const items = extras.filter(e => e.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})
  // Items with no category go last
  const uncategorized = extras.filter(e => !e.category || !EXTRAS_CATEGORIES.includes(e.category as never))

  const grandTotal = isInternal
    ? depositAmountCents
    : stripeAmount

  return (
    <div className={`px-4 py-4 bg-zinc-50 border-t border-zinc-100 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

        {/* Guest info */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Guest</p>
          {customerName && <p className="text-sm font-medium text-zinc-900">{customerName}</p>}
          {customerEmail && <p className="text-sm text-zinc-500">{customerEmail}</p>}
          {customerPhone && <p className="text-sm text-zinc-500">{customerPhone}</p>}
          {guestNote && (
            <p className="text-sm text-zinc-400 italic mt-1">"{guestNote}"</p>
          )}
          {isInternal && (
            <div className="mt-2">
              <BookingSourceBadge source={bookingSource} hideIfWebsite />
            </div>
          )}
        </div>

        {/* Extras by category */}
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Extras</p>
          {extras.length === 0 ? (
            <p className="text-sm text-zinc-400">No extras</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byCategory).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-xs text-zinc-400 capitalize mb-1">{cat}</p>
                  {items.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-zinc-700">{item.name}</span>
                      <span className={`font-medium ${isInternal ? 'text-zinc-400' : 'text-zinc-900'}`}>
                        {isInternal ? <span className="line-through text-zinc-300">{fmtAdminAmount(item.amount_cents)}</span> : fmtAdminAmount(item.amount_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {uncategorized.length > 0 && uncategorized.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-zinc-700">{item.name}</span>
                  <span className="font-medium text-zinc-900">{fmtAdminAmount(item.amount_cents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Price breakdown */}
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            {isInternal ? 'Deposit' : 'Price'}
          </p>
          <div className="space-y-1 text-sm">
            {!isInternal && (
              <>
                {baseAmountCents != null && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Base</span>
                    <span className="text-zinc-900">{fmtAdminAmount(baseAmountCents)}</span>
                  </div>
                )}
                {extrasAmountCents != null && extrasAmountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Extras</span>
                    <span className="text-zinc-900">{fmtAdminAmount(extrasAmountCents)}</span>
                  </div>
                )}
                {totalVatAmountCents != null && totalVatAmountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">VAT (incl.)</span>
                    <span className="text-zinc-500">{fmtAdminAmount(totalVatAmountCents)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-zinc-200 pt-1 mt-1">
                  <span className="text-zinc-900">Total charged</span>
                  <span className="text-zinc-900">{grandTotal != null ? fmtAdminAmount(grandTotal) : '—'}</span>
                </div>
              </>
            )}
            {isInternal && (
              <>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Platform deposit</span>
                  <span className="text-zinc-900 font-semibold">
                    {depositAmountCents != null && depositAmountCents > 0 ? fmtAdminAmount(depositAmountCents) : '€0'}
                  </span>
                </div>
                {baseAmountCents != null && (
                  <div className="flex justify-between text-zinc-400">
                    <span>Cruise value</span>
                    <span className="line-through">{fmtAdminAmount(baseAmountCents)}</span>
                  </div>
                )}
                <p className="text-xs text-zinc-400 mt-2">No Stripe charge — internal booking</p>
              </>
            )}
          </div>
        </div>

      </div>

      {/* Action buttons — only for non-cancelled bookings */}
      {!isCancelled && (
        <div className="flex items-center gap-2 pt-3 border-t border-zinc-100 mt-4">
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit details
          </button>
          <button
            onClick={() => setShowReschedule(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Reschedule
          </button>
          <button
            onClick={() => setShowCancel(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <Ban className="w-3.5 h-3.5" />
            Cancel booking
          </button>
        </div>
      )}

      {showCancel && (
        <CancelBookingModal
          bookingId={bookingId}
          guestName={customerName}
          cruiseTitle={listingTitle}
          bookingDate={bookingDate}
          isWebsiteBooking={isWebsiteBooking}
          totalAmountCents={stripeAmount}
          onClose={() => setShowCancel(false)}
          onSuccess={() => { setShowCancel(false); onRefresh() }}
        />
      )}
      {showEdit && (
        <EditBookingModal
          bookingId={bookingId}
          initialName={customerName}
          initialEmail={customerEmail}
          initialPhone={customerPhone}
          initialNote={guestNote}
          isInternalBooking={!!isInternal}
          initialDepositCents={depositAmountCents}
          onClose={() => setShowEdit(false)}
          onSuccess={() => { setShowEdit(false); onRefresh() }}
        />
      )}
      {showReschedule && (
        <RescheduleBookingModal
          bookingId={bookingId}
          listingId={listingId}
          currentDate={bookingDate}
          currentStartAt={startTime}
          guestName={customerName}
          cruiseTitle={listingTitle}
          onClose={() => setShowReschedule(false)}
          onSuccess={() => { setShowReschedule(false); onRefresh() }}
        />
      )}
    </div>
  )
}
