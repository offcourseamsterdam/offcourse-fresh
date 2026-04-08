'use client'

import { useState, useEffect } from 'react'
import { ratePrice } from '@/components/admin/fareharbor/helpers'
import { StepBar } from '@/components/admin/fareharbor/StepBar'
import { DateListingsStep } from '@/components/admin/fareharbor/DateListingsStep'
import { TimeSlotStep } from '@/components/admin/fareharbor/TimeSlotStep'
import { GuestInfoStep } from '@/components/admin/fareharbor/GuestInfoStep'
import { ExtrasStepPanel } from '@/components/admin/fareharbor/ExtrasStepPanel'
import { PaymentStep } from '@/components/admin/fareharbor/PaymentStep'
import { ConfirmationStep } from '@/components/admin/fareharbor/ConfirmationStep'
import type { Listing, Slot, Rate, Contact, PendingBooking } from '@/components/admin/fareharbor/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

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

  // Step 5 — Stripe
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [grandTotalCents, setGrandTotalCents] = useState<number | null>(null)
  const [creatingIntent, setCreatingIntent] = useState(false)
  const [intentError, setIntentError] = useState<string | null>(null)

  // Step 6 — Confirmation
  const [booking, setBooking] = useState<unknown>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)

  // ── Handle return from redirect-based payment (iDEAL, Bancontact etc.) ──
  // Stripe appends ?payment_intent=pi_xxx&redirect_status=succeeded to the return_url.
  // We restore booking state from sessionStorage and create the FH booking.
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
          // Clean URL (removes Stripe params)
          window.history.replaceState({}, '', window.location.pathname)
          // Restore state and create booking
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

  // ── Step 4 → 5: Extras confirmed → Create Stripe PaymentIntent ──────────

  async function handleExtrasContinue(selectedExtraIds: string[], calculation: ExtrasCalculation) {
    if (!selectedSlot || !selectedRate || !selectedListing) return
    setExtrasStep({ selectedExtraIds, calculation })
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

  // ── Step 5 → 6: Create FH booking after payment succeeds ────────────────

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
          // Extra context for Supabase, Slack, and email
          listingId: payload.selectedListing.id,
          listingTitle: payload.selectedListing.title,
          departureLocation: payload.selectedListing.departure_location ?? 'Keizersgracht 62, Amsterdam',
          date: payload.date,
          startAt: payload.selectedSlot.start_at,
          endAt: payload.selectedSlot.end_at,
          amountCents: calc ? calc.grand_total_cents : baseAmountCents,
          stripePaymentIntentId: piId,
          // Extras fields
          baseAmountCents: calc?.base_amount_cents ?? baseAmountCents,
          extrasSelected: calc?.line_items ?? [],
          extrasAmountCents: calc?.extras_amount_cents ?? 0,
          extrasVatAmountCents: calc?.extras_vat_amount_cents ?? 0,
          baseVatAmountCents: calc?.base_vat_amount_cents ?? 0,
          totalVatAmountCents: calc?.total_vat_amount_cents ?? 0,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setBooking(json.booking)
        // Fire Google Ads conversion — fires for both on-page and redirect paths
        if (typeof window !== 'undefined' && window.gtag) {
          const totalCents = calc ? calc.grand_total_cents : baseAmountCents
          window.gtag('event', 'conversion', {
            send_to: 'AW-CONVERSION_ID/CONVERSION_LABEL', // replace with real IDs before going live
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
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">FareHarbor Booking Flow</h1>
        <p className="text-sm text-zinc-500 mt-1">End-to-end booking test · live FareHarbor API · live Stripe</p>
      </div>

      <StepBar step={step} />

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

      {step === 5 && clientSecret && selectedRate && selectedListing && selectedSlot && (
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

      {step === 6 && (
        <ConfirmationStep
          bookingLoading={bookingLoading}
          bookingError={bookingError}
          booking={booking}
          paymentIntentId={paymentIntentId}
          onReset={reset}
        />
      )}
    </div>
  )
}
