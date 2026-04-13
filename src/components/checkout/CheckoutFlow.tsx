'use client'

import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { GuestInfoForm } from './GuestInfoForm'
import { BookingSummary } from './BookingSummary'
import { BOATS } from '@/lib/fareharbor/config'
import { SESSION_BOOKING_KEY, SESSION_CONTACT_KEY } from '@/lib/constants'
import { getErrorMessage } from '@/lib/utils'
import type { CustomerDetails, AvailabilitySlot, AvailabilityCustomerType } from '@/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

// ── Booking data shape (from sessionStorage) ────────────────────────────────

interface BookingData {
  listingId: string
  listingSlug: string
  listingTitle: string
  listingHeroImageUrl: string | null
  category: 'private' | 'shared'
  date: string
  guests: number
  selectedSlot: AvailabilitySlot
  selectedBoat: string | null
  selectedCustomerType: AvailabilityCustomerType | null
  ticketCounts: Record<number, number>
  totalTickets: number
  selectedExtraIds: string[]
  extrasCalculation: ExtrasCalculation | null
  basePriceCents: number
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CheckoutFlowProps {
  listingSlug: string
  cancellationPolicy?: string | null
}

// ── Progress indicator ───────────────────────────────────────────────────────

function CheckoutProgress({ step }: { step: 'details' | 'payment' }) {
  const steps = [
    { key: 'cruise', label: 'Cruise' },
    { key: 'details', label: 'Details' },
    { key: 'payment', label: 'Payment' },
  ] as const

  const activeIndex = step === 'details' ? 1 : 2

  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => {
        const isDone = i < activeIndex
        const isActive = i === activeIndex
        return (
          <div key={s.key} className="flex items-center gap-0 flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                ${isDone ? 'bg-[var(--color-primary)] text-white' : isActive ? 'bg-[var(--color-primary)] text-white ring-4 ring-[var(--color-primary)]/20' : 'bg-zinc-100 text-zinc-400'}`}>
                {isDone ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${isActive ? 'text-zinc-900' : isDone ? 'text-[var(--color-primary)]' : 'text-zinc-400'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 mx-2 mb-4 transition-colors ${isDone ? 'bg-[var(--color-primary)]' : 'bg-zinc-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Payment inner form (needs to be inside <Elements>) ──────────────────────

function PaymentForm({
  amountCents,
  onSuccess,
  bookingData,
}: {
  amountCents: number
  onSuccess: (paymentIntentId: string) => void
  bookingData: BookingData
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setPaying(true)
    setError(null)

    // Save booking state for iDEAL redirect recovery
    sessionStorage.setItem(SESSION_BOOKING_KEY, JSON.stringify(bookingData))

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href.split('?')[0],
      },
      redirect: 'if_required',
    })

    if (result.error) {
      setError(result.error.message ?? 'Payment failed. Please try again.')
      setPaying(false)
    } else if (result.paymentIntent?.status === 'succeeded') {
      sessionStorage.removeItem(SESSION_BOOKING_KEY)
      onSuccess(result.paymentIntent.id)
    }
  }

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <h2 className="text-lg font-bold text-zinc-900">Payment</h2>
      <PaymentElement options={{ wallets: { applePay: 'auto', googlePay: 'auto' } }} />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || paying}
        className="w-full py-3.5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-bold hover:bg-[var(--color-accent-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {paying ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Processing...
          </span>
        ) : (
          `Confirm & Pay €${(amountCents / 100).toFixed(2)}`
        )}
      </button>

      <p className="text-[10px] text-zinc-400 text-center">
        By confirming, you agree to our cancellation policy and terms of service.
      </p>
    </form>
  )
}

// ── Main checkout flow ──────────────────────────────────────────────────────

export function CheckoutFlow({ listingSlug, cancellationPolicy }: CheckoutFlowProps) {
  const [bookingData, setBookingData] = useState<BookingData | null>(null)
  const [contact, setContact] = useState<CustomerDetails | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [creatingIntent, setCreatingIntent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load booking data from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_BOOKING_KEY)
    if (stored) {
      try {
        setBookingData(JSON.parse(stored))
      } catch {
        setError('Could not restore your booking. Please go back and try again.')
      }
    } else {
      setError('No booking data found. Please start your booking from the cruise page.')
    }

    // Restore contact from sessionStorage (survives iDEAL redirect)
    const storedContact = sessionStorage.getItem(SESSION_CONTACT_KEY)
    if (storedContact) {
      try { setContact(JSON.parse(storedContact)) } catch { /* ignore */ }
    }

    // Handle iDEAL redirect return
    const params = new URLSearchParams(window.location.search)
    const paymentIntent = params.get('payment_intent')
    const redirectStatus = params.get('redirect_status')
    if (paymentIntent && redirectStatus === 'succeeded') {
      handlePaymentSuccess(paymentIntent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Create PaymentIntent after guest info is submitted
  async function handleGuestInfoSubmit(details: CustomerDetails) {
    if (!bookingData) return
    setContact(details)
    // Persist contact for iDEAL redirect recovery (component re-mounts after bank redirect)
    sessionStorage.setItem(SESSION_CONTACT_KEY, JSON.stringify(details))
    setCreatingIntent(true)
    setError(null)

    try {
      const customerTypeRatePk = bookingData.category === 'private'
        ? bookingData.selectedCustomerType?.pk
        : bookingData.selectedSlot.customerTypes[0]?.pk

      const res = await fetch('/api/booking-flow/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseAmountCents: bookingData.basePriceCents,
          listingId: bookingData.listingId,
          listingTitle: bookingData.listingTitle,
          availPk: bookingData.selectedSlot.pk,
          customerTypeRatePk,
          guestCount: bookingData.guests,
          category: bookingData.category,
          date: bookingData.date,
          contact: { name: details.name, email: details.email, phone: details.phone },
          selectedExtraIds: bookingData.selectedExtraIds,
          durationMinutes: bookingData.selectedCustomerType?.durationMinutes ?? 90,
        }),
      })

      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to create payment')
      setClientSecret(json.data.clientSecret)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setCreatingIntent(false)
    }
  }

  // After Stripe payment success, create the FareHarbor booking
  async function handlePaymentSuccess(paymentIntentId: string) {
    if (!bookingData) return
    const stored = sessionStorage.getItem(SESSION_BOOKING_KEY)
    const data: BookingData = stored ? JSON.parse(stored) : bookingData

    // Recover contact from sessionStorage (survives iDEAL redirect where React state is lost)
    let contactData = contact
    if (!contactData) {
      const storedContact = sessionStorage.getItem(SESSION_CONTACT_KEY)
      if (storedContact) {
        try { contactData = JSON.parse(storedContact) } catch { /* ignore */ }
      }
    }

    if (!contactData?.name || !contactData?.email) {
      setError('Contact information was lost. Please go back and try again.')
      return
    }

    try {
      const customerTypeRatePk = data.category === 'private'
        ? data.selectedCustomerType?.pk
        : data.selectedSlot.customerTypes[0]?.pk

      const extrasTotalCents = data.extrasCalculation
        ? data.extrasCalculation.line_items.reduce((s, li) => s + li.amount_cents, 0)
        : 0
      const totalAmount = data.basePriceCents + extrasTotalCents

      const res = await fetch('/api/booking-flow/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availPk: data.selectedSlot.pk,
          customerTypeRatePk,
          guestCount: data.guests,
          category: data.category,
          contact: contactData,
          note: contactData.specialRequests || undefined,
          listingId: data.listingId,
          listingTitle: data.listingTitle,
          date: data.date,
          startAt: data.selectedSlot.startAt,
          endAt: data.selectedSlot.endAt,
          amountCents: totalAmount,
          stripePaymentIntentId: paymentIntentId,
          baseAmountCents: data.basePriceCents,
          selectedExtraIds: data.selectedExtraIds,
          extrasSelected: data.extrasCalculation?.line_items ?? [],
          extrasAmountCents: extrasTotalCents,
        }),
      })

      const bookingResult = await res.json()
      if (!bookingResult.ok) {
        setError('Booking could not be completed. Your payment was received — please contact us at info@offcourseamsterdam.com')
        return
      }

      sessionStorage.removeItem(SESSION_BOOKING_KEY)
      sessionStorage.removeItem(SESSION_CONTACT_KEY)
      window.location.href = `/book/${data.listingSlug}/confirmation?payment_intent=${paymentIntentId}`
    } catch {
      setError('Something went wrong creating your booking. Your payment was received — please contact us at info@offcourseamsterdam.com')
    }
  }

  // Error state
  if (error && !bookingData) {
    return (
      <div className="text-center py-20">
        <p className="text-zinc-600 mb-4">{error}</p>
        <a href={`/cruises/${listingSlug}`} className="text-[var(--color-primary)] font-medium hover:underline">
          Back to cruise page
        </a>
      </div>
    )
  }

  if (!bookingData) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  const boat = BOATS.find(b => b.id === bookingData.selectedBoat)
  const boatName = boat?.name ?? null
  const boatImageUrl = boat?.imageUrl ?? bookingData.listingHeroImageUrl

  const cruiseLabel = boatName && bookingData.selectedCustomerType
    ? `${boatName} · ${Math.floor(bookingData.selectedCustomerType.durationMinutes / 60)}h`
    : 'Cruise'

  const extrasTotalCents = bookingData.extrasCalculation
    ? bookingData.extrasCalculation.extras_amount_cents
    : 0
  const totalAmountCents = bookingData.basePriceCents + extrasTotalCents

  const currentStep = clientSecret ? 'payment' : 'details'

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Back link */}
      <a
        href={`/cruises/${listingSlug}`}
        className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M15 18l-6-6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to cruise
      </a>

      {/* White card container */}
      <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8">
      {/* Progress indicator */}
      <CheckoutProgress step={currentStep} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12">
        {/* Left column: form + payment */}
        <div className="lg:col-span-3 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            {!clientSecret ? (
              <motion.div
                key="details"
                initial={{ x: 0, opacity: 1 }}
                exit={{ x: '-100%', opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              >
                <GuestInfoForm onSubmit={handleGuestInfoSubmit} loading={creatingIntent} />
              </motion.div>
            ) : (
              <motion.div
                key="payment"
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              >
                <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
                  <PaymentForm
                    amountCents={totalAmountCents}
                    onSuccess={handlePaymentSuccess}
                    bookingData={bookingData}
                  />
                </Elements>
              </motion.div>
            )}
          </AnimatePresence>

          {error && clientSecret && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mt-4">
              {error}
            </div>
          )}
        </div>

        {/* Right column: summary */}
        <div className="lg:col-span-2">
          <div className="sticky top-24">
            <BookingSummary
              listingTitle={bookingData.listingTitle}
              imageUrl={boatImageUrl}
              category={bookingData.category}
              date={bookingData.date}
              time={bookingData.selectedSlot.startTime}
              boatName={boatName}
              durationMinutes={bookingData.selectedCustomerType?.durationMinutes ?? null}
              guestCount={bookingData.guests}
              basePriceCents={bookingData.basePriceCents}
              extrasCalculation={bookingData.extrasCalculation}
              cancellationPolicy={cancellationPolicy}
              cruiseLabel={cruiseLabel}
            />
          </div>
        </div>
      </div>
      </div>
    </div>
}
