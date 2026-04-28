'use client'

import { useState, useEffect } from 'react'
import { ratePrice } from '@/components/admin/fareharbor/helpers'
import { StepBar } from '@/components/admin/fareharbor/StepBar'
import { DateListingsStep } from '@/components/admin/fareharbor/DateListingsStep'
import { TimeSlotStep } from '@/components/admin/fareharbor/TimeSlotStep'
import { GuestInfoStep } from '@/components/admin/fareharbor/GuestInfoStep'
import { ExtrasStepPanel } from '@/components/admin/fareharbor/ExtrasStepPanel'
import { PaymentStep } from '@/components/admin/fareharbor/PaymentStep'
import { PaymentLinkStep } from '@/components/admin/fareharbor/PaymentLinkStep'
import { ConfirmationStep } from '@/components/admin/fareharbor/ConfirmationStep'
import type { Listing, Slot, Rate, Contact, PendingBooking } from '@/components/admin/fareharbor/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'
import { BOOKING_SOURCES } from '@/lib/constants'
import type { BookingSource } from '@/lib/constants'

// Declare gtag so TypeScript doesn't complain
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function BookingFlowPage() {
  const today = new Date().toISOString().slice(0, 10)

  // Step state
  const [step, setStep] = useState(1)

  // Booking source (determines whether Stripe is used)
  const [bookingSource, setBookingSource] = useState<BookingSource>('website')
  const [depositAmountCents, setDepositAmountCents] = useState(0)
  const [depositInput, setDepositInput] = useState('0')

  // Step 1
  const [date, setDate] = useState(today)
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null)

  // Step 2
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null)
  const [guestCount, setGuestCount] = useState(2)

  // Step 3
  const [contact, setContact] = useState<Contact>({ name: '', email: '', phone: '', note: '' })

  // Step 4 — Extras
  const [extrasStep, setExtrasStep] = useState<{
    selectedExtraIds: string[]
    calculation: ExtrasCalculation
  } | null>(null)

  // Step 5 — Stripe (website only)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [grandTotalCents, setGrandTotalCents] = useState<number | null>(null)
  const [creatingIntent, setCreatingIntent] = useState(false)
  const [intentError, setIntentError] = useState<string | null>(null)

  // Step 6 — Confirmation
  const [booking, setBooking] = useState<unknown>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null)

  const isInternal = bookingSource !== 'website'

  // Sync deposit input when source changes
  useEffect(() => {
    if (bookingSource === 'complimentary') {
      setDepositAmountCents(0)
      setDepositInput('0')
    }
  }, [bookingSource])

  // ── Handle return from redirect-based payment (iDEAL, Bancontact etc.) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const redirectStatus = params.get('redirect_status')
    const piId = params.get('payment_intent')

    if (redirectStatus === 'succeeded' && piId) {
      const raw = sessionStorage.getItem('pendingBooking')
      if (raw) {
        try {
          const pending: Omit<PendingBooking, 'paymentIntentId'> = JSON.parse(raw)
          sessionStorage.removeItem('pendingBooking')
          window.history.replaceState({}, '', window.location.pathname)
          setDate(pending.date)
          setSelectedListing(pending.selectedListing)
          setSelectedSlot(pending.selectedSlot)
          setSelectedRate(pending.selectedRate)
          setGuestCount(pending.guestCount)
          setContact(pending.contact)
          if (pending.extrasCalculation) {
            setExtrasStep({
              selectedExtraIds: pending.selectedExtraIds,
              calculation: pending.extrasCalculation,
            })
          }
          setStep(6)
          createFHBooking(piId, pending)
        } catch {
          // sessionStorage data was malformed — ignore, user starts fresh
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Step 1 → 2: Pick listing ────────────────────────────────────────────

  function pickListing(listing: Listing) {
    setSelectedListing(listing)
    setSelectedSlot(null)
    setSelectedRate(null)
    setStep(2)
  }

  // ── Step 2: Pick slot + rate ────────────────────────────────────────────

  function pickSlot(slot: Slot) {
    setSelectedSlot(slot)
    setSelectedRate(null)
  }

  // ── Step 4 → 5: Extras confirmed ────────────────────────────────────────

  async function handleExtrasContinue(selectedExtraIds: string[], calculation: ExtrasCalculation) {
    if (!selectedSlot || !selectedRate || !selectedListing) return
    setExtrasStep({ selectedExtraIds, calculation })

    if (bookingSource === 'payment_link') {
      // Payment link booking: show price step, we'll create FH booking + Stripe session there
      setStep(5)
      return
    }

    if (isInternal) {
      // Internal booking: skip Stripe, go straight to deposit step (or confirm for comp)
      if (bookingSource === 'complimentary') {
        // Complimentary: no deposit, confirm immediately
        setStep(5)
      } else {
        // Platform booking: show deposit amount step
        setStep(5)
      }
      return
    }

    // Website booking: create Stripe PaymentIntent as before
    setCreatingIntent(true)
    setIntentError(null)

    const baseAmountCents = ratePrice(selectedRate)
    if (!baseAmountCents) {
      setIntentError('Price not available for this option')
      setCreatingIntent(false)
      return
    }

    try {
      const res = await fetch('/api/admin/booking-flow/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseAmountCents,
          listingId: selectedListing.id,
          listingTitle: selectedListing.title,
          availPk: selectedSlot.pk,
          customerTypeRatePk: selectedRate.pk,
          guestCount,
          category: selectedListing.category,
          date,
          contact: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
          },
          selectedExtraIds,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setClientSecret(json.clientSecret)
        setGrandTotalCents(json.calculation?.grand_total_cents ?? null)
        setStep(5)
      } else {
        setIntentError(json.error ?? 'Failed to initialise payment')
      }
    } catch {
      setIntentError('Network error')
    } finally {
      setCreatingIntent(false)
    }
  }

  // ── Internal: confirm booking directly (no Stripe) ──────────────────────

  async function handleInternalConfirm() {
    if (!selectedSlot || !selectedRate || !selectedListing) return
    const calc = extrasStep?.calculation ?? null
    const baseAmountCents = ratePrice(selectedRate) ?? 0

    setBookingLoading(true)
    setBookingError(null)
    setStep(6)

    try {
      const res = await fetch('/api/admin/booking-flow/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availPk: selectedSlot.pk,
          customerTypeRatePk: selectedRate.pk,
          guestCount,
          category: selectedListing.category,
          contact: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
          },
          note: contact.note || undefined,
          listingId: selectedListing.id,
          listingTitle: selectedListing.title,
          departureLocation: selectedListing.departure_location ?? 'Keizersgracht 62, Amsterdam',
          date,
          startAt: selectedSlot.start_at,
          endAt: selectedSlot.end_at,
          amountCents: 0,
          baseAmountCents: calc?.base_amount_cents ?? baseAmountCents,
          extrasSelected: calc?.line_items ?? [],
          extrasAmountCents: calc?.extras_amount_cents ?? 0,
          extrasVatAmountCents: calc?.extras_vat_amount_cents ?? 0,
          baseVatAmountCents: calc?.base_vat_amount_cents ?? 0,
          totalVatAmountCents: calc?.total_vat_amount_cents ?? 0,
          bookingSource,
          depositAmountCents,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setBooking(json.booking)
      } else {
        setBookingError(json.errors ? json.errors.join(', ') : json.error ?? 'Booking failed')
      }
    } catch {
      setBookingError('Network error while creating booking')
    } finally {
      setBookingLoading(false)
    }
  }

  // ── Step 5 → 6: Create FH booking after Stripe payment succeeds ─────────

  async function handlePaymentSuccess(piId: string) {
    if (!selectedSlot || !selectedRate || !selectedListing) return
    await createFHBooking(piId, {
      availPk: selectedSlot.pk,
      customerTypeRatePk: selectedRate.pk,
      guestCount,
      category: selectedListing.category,
      contact,
      selectedListing,
      selectedSlot,
      selectedRate,
      date,
      selectedExtraIds: extrasStep?.selectedExtraIds ?? [],
      extrasCalculation: extrasStep?.calculation ?? null,
    })
  }

  async function createFHBooking(
    piId: string,
    payload: Omit<PendingBooking, 'paymentIntentId'>
  ) {
    setPaymentIntentId(piId)
    setBookingLoading(true)
    setBookingError(null)
    setStep(6)

    const baseAmountCents = ratePrice(payload.selectedRate) ?? 0
    const calc = payload.extrasCalculation

    try {
      const res = await fetch('/api/admin/booking-flow/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availPk: payload.availPk,
          customerTypeRatePk: payload.customerTypeRatePk,
          guestCount: payload.guestCount,
          category: payload.category,
          contact: {
            name: payload.contact.name,
            email: payload.contact.email,
            phone: payload.contact.phone,
          },
          note: payload.contact.note || undefined,
          listingId: payload.selectedListing.id,
          listingTitle: payload.selectedListing.title,
          departureLocation: payload.selectedListing.departure_location ?? 'Keizersgracht 62, Amsterdam',
          date: payload.date,
          startAt: payload.selectedSlot.start_at,
          endAt: payload.selectedSlot.end_at,
          amountCents: calc ? calc.grand_total_cents : baseAmountCents,
          stripePaymentIntentId: piId,
          baseAmountCents: calc?.base_amount_cents ?? baseAmountCents,
          extrasSelected: calc?.line_items ?? [],
          extrasAmountCents: calc?.extras_amount_cents ?? 0,
          extrasVatAmountCents: calc?.extras_vat_amount_cents ?? 0,
          baseVatAmountCents: calc?.base_vat_amount_cents ?? 0,
          totalVatAmountCents: calc?.total_vat_amount_cents ?? 0,
          bookingSource: 'website',
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setBooking(json.booking)
        if (typeof window !== 'undefined' && window.gtag) {
          const totalCents = calc ? calc.grand_total_cents : baseAmountCents
          window.gtag('event', 'conversion', {
            send_to: 'AW-CONVERSION_ID/CONVERSION_LABEL',
            value: totalCents / 100,
            currency: 'EUR',
            transaction_id: piId,
          })
        }
      } else {
        setBookingError(json.errors ? json.errors.join(', ') : json.error ?? 'Booking failed')
      }
    } catch {
      setBookingError('Network error while creating booking')
    } finally {
      setBookingLoading(false)
    }
  }

  function reset() {
    setStep(1)
    setSelectedListing(null)
    setSelectedSlot(null)
    setSelectedRate(null)
    setContact({ name: '', email: '', phone: '', note: '' })
    setExtrasStep(null)
    setClientSecret(null)
    setGrandTotalCents(null)
    setBooking(null)
    setBookingError(null)
    setPaymentIntentId(null)
    setPaymentLinkUrl(null)
    setBookingSource('website')
    setDepositAmountCents(0)
    setDepositInput('0')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">FareHarbor Booking Flow</h1>
        <p className="text-sm text-zinc-500 mt-1">End-to-end booking · live FareHarbor API</p>
      </div>

      {/* Booking source selector — always visible at top */}
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-zinc-600">Booking source:</span>
        <div className="flex items-center gap-2 flex-wrap">
          {BOOKING_SOURCES.map(src => (
            <button
              key={src.value}
              onClick={() => setBookingSource(src.value)}
              disabled={step > 1}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${
                bookingSource === src.value
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {src.label}
            </button>
          ))}
        </div>
      </div>

      <StepBar step={step} isInternal={isInternal} />

      {step === 1 && (
        <DateListingsStep
          date={date}
          onDateChange={setDate}
          onPickListing={pickListing}
        />
      )}

      {step === 2 && selectedListing && (
        <TimeSlotStep
          listing={selectedListing}
          date={date}
          selectedSlot={selectedSlot}
          selectedRate={selectedRate}
          guestCount={guestCount}
          onBack={() => setStep(1)}
          onPickSlot={pickSlot}
          onPickRate={setSelectedRate}
          onGuestCountChange={setGuestCount}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <GuestInfoStep
          contact={contact}
          onContactChange={setContact}
          selectedListing={selectedListing}
          selectedSlot={selectedSlot}
          selectedRate={selectedRate}
          guestCount={guestCount}
          date={date}
          onBack={() => setStep(2)}
          onContinue={() => setStep(4)}
        />
      )}

      {step === 4 && selectedListing && selectedRate && (
        <ExtrasStepPanel
          listing={selectedListing}
          rate={selectedRate}
          guestCount={guestCount}
          creatingIntent={creatingIntent}
          intentError={intentError}
          onContinue={handleExtrasContinue}
          onBack={() => setStep(3)}
        />
      )}

      {/* Step 5 — Website: Stripe payment */}
      {step === 5 && !isInternal && clientSecret && selectedRate && selectedListing && selectedSlot && (
        <PaymentStep
          clientSecret={clientSecret}
          selectedListing={selectedListing}
          selectedSlot={selectedSlot}
          selectedRate={selectedRate}
          guestCount={guestCount}
          date={date}
          contact={contact}
          grandTotalCents={grandTotalCents}
          extrasStep={extrasStep}
          onBack={() => setStep(4)}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}

      {/* Step 5 — Payment link: set price + create FH booking + send link */}
      {step === 5 && bookingSource === 'payment_link' && selectedListing && selectedSlot && selectedRate && (
        <PaymentLinkStep
          listing={selectedListing}
          slot={selectedSlot}
          rate={selectedRate}
          guestCount={guestCount}
          contact={contact}
          date={date}
          extrasCalculation={extrasStep?.calculation ?? null}
          onBack={() => setStep(4)}
          onSuccess={(bookingId, paymentUrl) => {
            setPaymentLinkUrl(paymentUrl)
            setBooking({ id: bookingId })
            setStep(6)
          }}
        />
      )}

      {/* Step 5 — Internal: deposit amount + confirm */}
      {step === 5 && isInternal && bookingSource !== 'payment_link' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-6 space-y-4">
            <h3 className="font-semibold text-zinc-900">Confirm internal booking</h3>

            {/* Source reminder */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Source:</span>
              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-700">
                {BOOKING_SOURCES.find(s => s.value === bookingSource)?.label ?? bookingSource}
              </span>
            </div>

            {/* Deposit amount field — hidden for complimentary */}
            {bookingSource !== 'complimentary' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-700">
                  Deposit amount (€)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={depositInput}
                  onChange={e => {
                    setDepositInput(e.target.value)
                    const parsed = parseFloat(e.target.value)
                    if (!isNaN(parsed)) setDepositAmountCents(Math.round(parsed * 100))
                  }}
                  className="block w-48 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  placeholder="0.00"
                />
                <p className="text-xs text-zinc-400">Amount deposited to your account after platform fees.</p>
              </div>
            )}

            {bookingSource === 'complimentary' && (
              <p className="text-sm text-zinc-500">Complimentary booking — no deposit, no charge.</p>
            )}

            {/* Extras summary */}
            {extrasStep && extrasStep.calculation.line_items.length > 0 && (
              <div className="rounded-md bg-zinc-50 px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Extras (informational — not charged)</p>
                {extrasStep.calculation.line_items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-zinc-600">{item.name}</span>
                    <span className="text-zinc-400 line-through">€{(item.amount_cents / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(4)}
              className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleInternalConfirm}
              className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm font-semibold hover:bg-zinc-800 transition-colors"
            >
              Confirm Booking
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <ConfirmationStep
          bookingLoading={bookingLoading}
          bookingError={bookingError}
          booking={booking}
          paymentIntentId={paymentIntentId}
          paymentLinkUrl={paymentLinkUrl}
          onReset={reset}
        />
      )}
    </div>
  )
}
