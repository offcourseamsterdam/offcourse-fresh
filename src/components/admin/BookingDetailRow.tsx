'use client'

import { useState, useMemo, memo } from 'react'
import { Pencil, Ban, CalendarDays, UtensilsCrossed, Megaphone, Tag, Building2, CheckCircle2, FileText } from 'lucide-react'
import { EXTRAS_CATEGORIES } from '@/lib/constants'
import { fmtAdminAmount } from '@/lib/admin/format'
import { BookingSourceBadge } from '@/components/admin/BookingSourceBadge'

import { CancelBookingModal } from '@/components/admin/booking-actions/CancelBookingModal'
import { EditBookingModal } from '@/components/admin/booking-actions/EditBookingModal'
import { RescheduleBookingModal } from '@/components/admin/booking-actions/RescheduleBookingModal'
import { AddCateringModal } from '@/components/admin/booking-actions/AddCateringModal'
import { SendInvoiceModal } from '@/components/admin/SendInvoiceModal'
import { cateringAmountCents } from '@/lib/catering/filter'
import type { AdminExtraLineItem } from '@/lib/admin/types'

// ── Types ──────────────────────────────────────────────────────────────────

interface BookingDetailRowProps {
  bookingId: string
  bookingUuid: string | null
  listingId: string | null
  status: string | null
  paymentStatus?: string | null
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
  stripeInvoiceId?: string | null
  stripeInvoiceUrl?: string | null
  companyName?: string | null
  companyKvk?: string | null
  companyVat?: string | null
  companyAddress?: string | null
  invoiceDueDate?: string | null
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────────

export const BookingDetailRow = memo(function BookingDetailRow({
  bookingId,
  bookingUuid: _bookingUuid,
  listingId,
  status,
  paymentStatus,
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
  stripeInvoiceId,
  stripeInvoiceUrl,
  companyName,
  companyKvk,
  companyVat,
  companyAddress,
  invoiceDueDate,
  className = '',
}: BookingDetailRowProps) {
  const [showCancel, setShowCancel] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showReschedule, setShowReschedule] = useState(false)
  const [showAddCatering, setShowAddCatering] = useState(false)
  const [showSendInvoice, setShowSendInvoice] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)

  const isCancelled = status === 'cancelled'
  const isInternal = bookingSource && bookingSource !== 'website'
  const isWebsiteBooking = !bookingSource || bookingSource === 'website' || bookingSource === 'payment_link'
  // Stripe recovery + payment links + stripe invoices all involve real Stripe money — display like
  // paid bookings (Base, City tax, Total) rather than the deposit-style block
  // used for complimentary / partner / GYG bookings.
  const isStripeRecovery = bookingSource === 'stripe_recovery'
  const isPaymentLink = bookingSource === 'payment_link'
  const isStripeInvoice = bookingSource === 'stripe_invoice' || !!stripeInvoiceId
  const isPaymentPending = status === 'pending_payment' || paymentStatus === 'stripe_invoice_sent'
  const isDepositStyle = isInternal && !isStripeRecovery && !isPaymentLink && !isStripeInvoice
  const extras = (extrasSelected ?? []) as AdminExtraLineItem[]

  async function handleMarkInvoicePaid() {
    if (!confirm('Weet je zeker dat je deze factuur als betaald wilt markeren? Dit synchroniseert ook met Stripe.')) return
    setMarkingPaid(true)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/mark-invoice-paid`, { method: 'POST' })
      if (res.ok) {
        onRefresh()
      } else {
        alert('Fout bij markeren als betaald')
      }
    } catch {
      alert('Netwerkfout')
    } finally {
      setMarkingPaid(false)
    }
  }

  // Memoize extras grouping and catering calculations across parent renders
  const { byCategory, uncategorized, cateringCents } = useMemo(() => {
    const byCat = EXTRAS_CATEGORIES.reduce<Record<string, AdminExtraLineItem[]>>((acc, cat) => {
      const items = extras.filter(e => e.category === cat)
      if (items.length > 0) acc[cat] = items
      return acc
    }, {})
    const uncat = extras.filter(e => !e.category || !EXTRAS_CATEGORIES.includes(e.category as never))
    const catCents = cateringAmountCents(extras)
    return { byCategory: byCat, uncategorized: uncat, cateringCents: catCents }
  }, [extras])

  const grandTotal = isDepositStyle ? depositAmountCents : stripeAmount
  // City tax: €2.60 per guest. Stored only implicitly (it's the gap between
  // base + extras and stripe_amount). Show it as an explicit line so the math
  // is transparent to the admin.
  const cityTaxCents = (guestCount ?? 0) * 260

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

          {/* Company details if Stripe Invoicing */}
          {companyName && (
            <div className="mt-2.5 pt-2 border-t border-zinc-200 text-xs text-zinc-600 space-y-0.5">
              <p className="font-semibold text-zinc-900 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" /> {companyName}
              </p>
              {companyKvk && <p className="text-zinc-500 font-mono">KVK: {companyKvk}</p>}
              {companyVat && <p className="text-zinc-500 font-mono">BTW: {companyVat}</p>}
              {companyAddress && <p className="text-zinc-500">{companyAddress}</p>}
            </div>
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
                  <span className="text-zinc-900">
                    {isPaymentPending ? 'Amount due' : 'Total charged'}
                  </span>
                  <span className="text-zinc-900">{grandTotal != null ? fmtAdminAmount(grandTotal) : '—'}</span>
                </div>
                {isPaymentLink && isPaymentPending && (
                  <p className="text-[10px] text-amber-600 mt-2 font-medium">
                    💳 Payment link sent — awaiting payment from customer
                  </p>
                )}
                {isPaymentLink && !isPaymentPending && (
                  <p className="text-[10px] text-zinc-400 mt-2 italic">
                    Paid via payment link.
                  </p>
                )}
                {isStripeRecovery && (
                  <p className="text-[10px] text-zinc-400 mt-2 italic">
                    Manually recorded via Stripe recovery — actual Stripe charge may differ if refunded.
                  </p>
                )}
                {isStripeInvoice && stripeInvoiceUrl && (
                  <div className="mt-2.5 pt-2 border-t border-zinc-200 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Factuurstatus:</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {paymentStatus === 'paid' ? 'Betaald ✓' : 'Factuur open (wacht op betaling)'}
                      </span>
                    </div>
                    {invoiceDueDate && (
                      <div className="flex items-center justify-between text-zinc-500">
                        <span>Vervaldatum:</span>
                        <div className="text-right">
                          <span className="font-medium text-zinc-700">{invoiceDueDate}</span>
                          {paymentStatus !== 'paid' && (
                            <span className="text-[10px] block font-semibold text-amber-700">
                              {(() => {
                                const diff = Math.ceil((new Date(invoiceDueDate).getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24))
                                if (diff < 0) return `⚠️ ${Math.abs(diff)} dagen verlopen`
                                if (diff === 0) return '⚠️ Vervalt vandaag'
                                return `(nog ${diff} dagen)`
                              })()}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <a
                      href={stripeInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline pt-0.5"
                    >
                      Bekijk Stripe Factuur ↗
                    </a>
                  </div>
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
          {isStripeInvoice && paymentStatus !== 'paid' && (
            <button
              onClick={handleMarkInvoicePaid}
              disabled={markingPaid}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {markingPaid ? 'Bezig…' : 'Markeer factuur als betaald'}
            </button>
          )}
          {!stripeInvoiceId && paymentStatus !== 'paid' && (
            <button
              onClick={() => setShowSendInvoice(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Factuur sturen via Stripe
            </button>
          )}
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

      {showSendInvoice && (
        <SendInvoiceModal
          bookingId={bookingId}
          bookingDate={bookingDate}
          customerName={customerName}
          customerEmail={customerEmail}
          customerPhone={customerPhone}
          listingTitle={listingTitle}
          baseAmountCents={baseAmountCents}
          extrasAmountCents={extrasAmountCents}
          cityTaxCents={cityTaxCents}
          stripeAmount={stripeAmount}
          initialCompanyName={companyName}
          initialKvk={companyKvk}
          initialVat={companyVat}
          initialAddress={companyAddress}
          isOpen={showSendInvoice}
          onClose={() => setShowSendInvoice(false)}
          onSuccess={() => { setShowSendInvoice(false); onRefresh() }}
        />
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
})
