'use client'

import { useState } from 'react'
import { Pencil, Ban, CalendarDays, UtensilsCrossed, Megaphone, Tag } from 'lucide-react'
import { EXTRAS_CATEGORIES } from '@/lib/constants'
import { fmtAdminAmount } from '@/lib/admin/format'
import { BookingSourceBadge } from '@/components/admin/BookingSourceBadge'

import { CancelBookingModal } from '@/components/admin/booking-actions/CancelBookingModal'
import { EditBookingModal } from '@/components/admin/booking-actions/EditBookingModal'
import { RescheduleBookingModal } from '@/components/admin/booking-actions/RescheduleBookingModal'
import { AddCateringModal } from '@/components/admin/booking-actions/AddCateringModal'
import { cateringAmountCents } from '@/lib/catering/filter'
import type { AdminExtraLineItem } from '@/lib/admin/types'

// ── Types ──────────────────────────────────────────────────────────────────

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
  guestCount: number | null
  baseAmountCents: number | null
  extrasAmountCents: number | null
  totalVatAmountCents: number | null
  stripeAmount: number | null
  depositAmountCents: number | null
  extrasSelected: AdminExtraLineItem[] | null
  bookingSource: string | null
  campaignName: string | null
  promoCode: string | null
  discountAmountCents: number | null
  partnerName: string | null
  category: string | null
  customerTypeName: string | null
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────────

export function BookingDetailRow({
  bookingId,
  bookingUuid: _bookingUuid,
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
  guestCount,
  baseAmountCents,
  extrasAmountCents,
  totalVatAmountCents,
  stripeAmount,
  depositAmountCents,
  extrasSelected,
  bookingSource,
  campaignName,
  promoCode,
  discountAmountCents,
  partnerName,
  category,
  customerTypeName,
  className = '',
}: BookingDetailRowProps) {
  const [showCancel, setShowCancel] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showReschedule, setShowReschedule] = useState(false)
  const [showAddCatering, setShowAddCatering] = useState(false)

  const isCancelled = status === 'cancelled'
  const isInternal = bookingSource && bookingSource !== 'website'
  const isWebsiteBooking = !bookingSource || bookingSource === 'website'
  // Stripe recovery is "internal" in that the admin entered it manually,
  // but the money DID come in. Display it like a paid booking (Base, City tax,
  // Total charged) rather than the deposit-style block used for complimentary etc.
  const isStripeRecovery = bookingSource === 'stripe_recovery'
  const isDepositStyle = isInternal && !isStripeRecovery
  const extras = (extrasSelected ?? []) as AdminExtraLineItem[]

  // Group extras by category
  const byCategory = EXTRAS_CATEGORIES.reduce<Record<string, AdminExtraLineItem[]>>((acc, cat) => {
    const items = extras.filter(e => e.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})
  // Items with no category go last
  const uncategorized = extras.filter(e => !e.category || !EXTRAS_CATEGORIES.includes(e.category as never))

  const grandTotal = isDepositStyle ? depositAmountCents : stripeAmount
  // City tax: €2.60 per guest. Stored only implicitly (it's the gap between
  // base + extras and stripe_amount). Show it as an explicit line so the math
  // is transparent to the admin.
  const cityTaxCents = (guestCount ?? 0) * 260

  // Catering revenue breakdown
  const cateringCents = cateringAmountCents(extras)

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
            <p className="text-sm text-zinc-400 italic mt-1">&quot;{guestNote}&quot;</p>
          )}

          {/* Source — always shown */}
          <div className="mt-2">
            <BookingSourceBadge source={bookingSource} />
          </div>

          {/* Partner */}
          {partnerName && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-xs text-zinc-500">Partner:</span>
              <span className="text-xs text-zinc-900 font-medium">{partnerName}</span>
            </div>
          )}

          {/* Campaign */}
          {campaignName && (
            <div className="flex items-center gap-1.5 mt-1">
              <Megaphone className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="text-xs text-indigo-700 font-medium">{campaignName}</span>
            </div>
          )}

          {/* Promo code */}
          {promoCode && (
            <div className="flex items-center gap-1.5 mt-1">
              <Tag className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              <span className="text-xs text-emerald-700 font-medium">{promoCode}</span>
              {discountAmountCents != null && discountAmountCents > 0 && (
                <span className="text-xs text-zinc-400">−€{(discountAmountCents / 100).toFixed(0)}</span>
              )}
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
                  {items.map((item, i) => {
                    const qty = item.quantity ?? 1
                    const suffix = item.is_per_person_pick && qty > 0
                      ? ` — for ${qty} ${qty === 1 ? 'person' : 'people'}`
                      : qty > 1
                        ? ` ×${qty}`
                        : ''
                    return (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-zinc-700">
                          {item.name}{suffix}
                        </span>
                        <span className={`font-medium ${isDepositStyle ? 'text-zinc-400' : 'text-zinc-900'}`}>
                          {isDepositStyle
                            ? <span className="line-through text-zinc-300">{fmtAdminAmount(item.amount_cents)}</span>
                            : fmtAdminAmount(item.amount_cents)}
                        </span>
                      </div>
                    )
                  })}
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
            {isDepositStyle ? 'Deposit' : 'Price'}
          </p>
          <div className="space-y-1 text-sm">
            {!isDepositStyle && (
              <>
                {baseAmountCents != null && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Base</span>
                    <span className="text-zinc-900">{fmtAdminAmount(baseAmountCents)}</span>
                  </div>
                )}
                {cityTaxCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">City tax · €2.60 × {guestCount}</span>
                    <span className="text-zinc-900">{fmtAdminAmount(cityTaxCents)}</span>
                  </div>
                )}
                {extrasAmountCents != null && extrasAmountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Extras</span>
                    <span className="text-zinc-900">{fmtAdminAmount(extrasAmountCents)}</span>
                  </div>
                )}
                {cateringCents > 0 && (
                  <div className="flex justify-between text-xs text-zinc-400 pl-2">
                    <span className="flex items-center gap-1">
                      <UtensilsCrossed className="w-3 h-3" /> Catering
                    </span>
                    <span>{fmtAdminAmount(cateringCents)}</span>
                  </div>
                )}
                {totalVatAmountCents != null && totalVatAmountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">VAT (incl.)</span>
                    <span className="text-zinc-500">{fmtAdminAmount(totalVatAmountCents)}</span>
                  </div>
                )}
                {/* 2-decimal precision intentional: financial breakdown must show exact cents */}
                <div className="flex justify-between font-semibold border-t border-zinc-200 pt-1 mt-1">
                  <span className="text-zinc-900">Total charged</span>
                  <span className="text-zinc-900">{grandTotal != null ? fmtAdminAmount(grandTotal) : '—'}</span>
                </div>
                {isStripeRecovery && (
                  <p className="text-[10px] text-zinc-400 mt-2 italic">
                    Manually recorded via Stripe recovery — actual Stripe charge may differ if refunded.
                  </p>
                )}
              </>
            )}
            {isDepositStyle && (
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
        <div className="flex items-center gap-2 pt-3 border-t border-zinc-100 mt-4 flex-wrap">
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
            onClick={() => setShowAddCatering(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-600 hover:bg-amber-50 transition-colors"
          >
            <UtensilsCrossed className="w-3.5 h-3.5" />
            {cateringCents > 0 ? 'Edit catering' : 'Add catering'}
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
          category={category}
          originalCustomerTypeName={customerTypeName}
          onClose={() => setShowReschedule(false)}
          onSuccess={() => { setShowReschedule(false); onRefresh() }}
        />
      )}
      {showAddCatering && (
        <AddCateringModal
          bookingId={bookingId}
          guestCount={guestCount ?? 1}
          existingExtras={extras}
          baseAmountCents={baseAmountCents}
          onClose={() => setShowAddCatering(false)}
          onSuccess={() => { setShowAddCatering(false); onRefresh() }}
        />
      )}
    </div>
  )
}
