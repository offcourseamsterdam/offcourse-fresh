'use client'

import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Loader2 } from 'lucide-react'
import { GuestInfoForm } from './GuestInfoForm'
import { BookingSummary } from './BookingSummary'
import type { CustomerDetails, AvailabilitySlot, AvailabilityCustomerType } from '@/types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

const CITY_TAX_PER_PERSON_CENTS = 260

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
    sessionStorage.setItem('offcourse_booking', JSON.stringify(bookingData))

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
      sessionStorage.removeItem('offcourse_booking')
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
  const [bookingComplete, setBookingComplete] = useState(false)

  // Load booking data from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem('offcourse_booking')
    if (stored) {
      try {
        setBookingData(JSON.parse(stored))
      } catch {
        setError('Could not restore your booking. Please go back and try again.')
      }
    } else {
      setError('No booking data found. Please start your booking from the cruise page.')
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
        }),
      })

      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to create payment')
      setClientSecret(json.data.clientSecret)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setCreatingIntent(false)
    }
  }

  // After Stripe payment success, create the FareHarbor booking
  async function handlePaymentSuccess(paymentIntentId: string) {
    if (!bookingData) return
    const stored = sessionStorage.getItem('offcourse_booking')
    const data: BookingData = stored ? JSON.parse(stored) : bookingData

    try {
      const customerTypeRatePk = data.category === 'private'
        ? data.selectedCustomerType?.pk
        : data.selectedSlot.customerTypes[0]?.pk

      const cityTaxCents = data.guests * CITY_TAX_PER_PERSON_CENTS
      const extrasTotalCents = data.extrasCalculation
        ? data.extrasCalculation.line_items.reduce((s, li) => s + li.amount_cents, 0)
        : 0
      const totalAmount = data.basePriceCents + extrasTotalCents + cityTaxCents

      await fetch('/api/booking-flow/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availPk: data.selectedSlot.pk,
          customerTypeRatePk,
          guestCount: data.guests,
          category: data.category,
          contact: contact ?? { name: '', email: '', phone: '' },
          note: contact?.specialRequests || undefined,
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

      sessionStorage.removeItem('offcourse_booking')
      // Redirect to confirmation page
      window.location.href = `/book/${data.listingSlug}/confirmation?payment_intent=${paymentIntentId}`
    } catch {
      // Even if the booking API fails, payment went through.
      // Redirect to confirmation — the booking will be retried via webhook.
      window.location.href = `/book/${data.listingSlug}/confirmation?payment_intent=${paymentIntentId}`
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

  const boatName = bookingData.selectedBoat === 'diana' ? 'Diana'
    : bookingData.selectedBoat === 'curacao' ? 'Curaçao'
    : null

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Back link */}
      <a
        href={`/cruises/${listingSlug}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path d="M15 18l-6-6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to cruise
      </a>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12">
        {/* Left column: form + payment */}
        <div className="lg:col-span-3 space-y-8">
          {!clientSecret ? (
            <GuestInfoForm onSubmit={handleGuestInfoSubmit} loading={creatingIntent} />
          ) : (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
              <PaymentForm
                amountCents={bookingData.basePriceCents + (bookingData.extrasCalculation?.line_items.reduce((s, li) => s + li.amount_cents, 0) ?? 0) + bookingData.guests * CITY_TAX_PER_PERSON_CENTS}
                onSuccess={handlePaymentSuccess}
                bookingData={bookingData}
              />
            </Elements>
          )}

          {error && clientSecret && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Right column: summary */}
        <div className="lg:col-span-2">
          <div className="sticky top-24">
            <BookingSummary
              listingTitle={bookingData.listingTitle}
              listingHeroImageUrl={bookingData.listingHeroImageUrl}
              category={bookingData.category}
              date={bookingData.date}
              time={bookingData.selectedSlot.startTime}
              boatName={boatName}
              durationMinutes={bookingData.selectedCustomerType?.durationMinutes ?? null}
              guestCount={bookingData.guests}
              basePriceCents={bookingData.basePriceCents}
              extrasCalculation={bookingData.extrasCalculation}
              cancellationPolicy={cancellationPolicy}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
