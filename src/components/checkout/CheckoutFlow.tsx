'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { GuestInfoForm } from './GuestInfoForm'
import { BookingSummary } from './BookingSummary'
import { CancellationCutoff } from './CancellationCutoff'
import { CheckoutProgress } from './CheckoutProgress'
import { PromoCodeInput } from './PromoCodeInput'
import { PaymentStep } from './PaymentStep'
import type { BookingData, ServerQuote, PromoResult } from './types'
import { trackEvent, getSessionId } from '@/lib/tracking/client'
import { BOATS } from '@/lib/fareharbor/config'
import { SESSION_BOOKING_KEY, SESSION_CONTACT_KEY } from '@/lib/constants'
import { getErrorMessage } from '@/lib/utils'
import type { CustomerDetails } from '@/types'
import type { CancellationTier } from '@/lib/cancellation/policy'

import { stripePublishableKey, stripeIsTestMode } from '@/lib/stripe/keys'

const stripePromise = loadStripe(stripePublishableKey)

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildCustomerTypeRates(data: BookingData) {
  // NOTE the two distinct PKs on AvailabilityCustomerType:
  //   ct.pk            = the customer_type_RATE pk (what FareHarbor availability is keyed by)
  //   ct.customerTypePk = the customer_TYPE pk (what ticketCounts is keyed by, see TicketStep)
  // The server + FH booking need the RATE pk, so we send ct.pk while reading counts by customerTypePk.
  const customerTypeRates = data.category === 'shared'
    ? data.selectedSlot.customerTypes
        .filter(ct => (data.ticketCounts?.[ct.customerTypePk] ?? 0) > 0)
        .map(ct => ({ pk: ct.pk, count: data.ticketCounts[ct.customerTypePk] }))
    : undefined
  const customerTypeRatePk = data.category === 'private'
    ? data.selectedCustomerType?.pk
    : (customerTypeRates?.[0]?.pk ?? data.selectedSlot.customerTypes[0]?.pk)
  return { customerTypeRates, customerTypeRatePk }
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CheckoutFlowProps {
  listingSlug: string
  /** Tiered cancellation policy from the parent FareHarbor item. */
  cancellationTiers?: CancellationTier[] | null
  initialCode?: string
  paymentMode?: 'stripe' | 'partner_invoice'
  partnerName?: string | null
}

// ── Main checkout flow ──────────────────────────────────────────────────────

export function CheckoutFlow({
  listingSlug,
  cancellationTiers,
  initialCode,
  paymentMode = 'stripe',
  partnerName,
}: CheckoutFlowProps) {
  const isPartnerInvoice = paymentMode === 'partner_invoice'
  const [bookingData, setBookingData] = useState<BookingData | null>(null)
  const [, setContact] = useState<CustomerDetails | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [creatingIntent, setCreatingIntent] = useState(false)
  const [submittingPartnerBooking, _setSubmittingPartnerBooking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True while completing an iDEAL booking after the bank redirect — renders a
  // blocking "finalising your payment" screen instead of the checkout form.
  const [recovering, setRecovering] = useState(false)
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null)
  // Server-canonical price quote — single source of truth for what's displayed and charged
  const [quote, setQuote] = useState<ServerQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  // Load booking data from sessionStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const paymentIntent = params.get('payment_intent')
    const redirectStatus = params.get('redirect_status')
    // 'processing' counts too: iDEAL banks can send the customer back before
    // Stripe has settled the payment — the recovery endpoint handles both.
    const isIdealReturn = !!(paymentIntent && (redirectStatus === 'succeeded' || redirectStatus === 'processing'))
    const isIdealFailed = !!(paymentIntent && redirectStatus === 'requires_payment_method')

    const stored = sessionStorage.getItem(SESSION_BOOKING_KEY)
    if (stored) {
      try {
        setBookingData(JSON.parse(stored))
      } catch {
        setError('Could not restore your booking. Please go back and try again.')
      }
    } else if (!isIdealReturn) {
      // Only show "no data" error when we're NOT returning from an iDEAL redirect —
      // in that case handlePaymentSuccess below will call the recovery endpoint.
      setError('No booking data found. Please start your booking from the cruise page.')
    }

    // Restore contact from sessionStorage (survives iDEAL redirect)
    const storedContact = sessionStorage.getItem(SESSION_CONTACT_KEY)
    if (storedContact) {
      try { setContact(JSON.parse(storedContact)) } catch { /* ignore */ }
    }

    // iDEAL redirect returned with a non-success status — show the right message.
    if (isIdealFailed) {
      setError('Your bank declined the payment. Please try again with a different payment method.')
    }

    // Handle iDEAL redirect return — show a full-screen "finalising" state so
    // the customer can't interact with (or re-submit) the checkout form while
    // the booking is being completed in the background.
    if (isIdealReturn) {
      setRecovering(true)
      handlePaymentSuccess(paymentIntent!).finally(() => setRecovering(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track checkout view on mount
  useEffect(() => {
    if (bookingData) trackEvent('view_details', { listing: bookingData.listingSlug })
  }, [bookingData])

  // ── Server-canonical pricing ─────────────────────────────────────────────
  //
  // Whenever the booking inputs (or applied promo) change, ask the server for
  // a fresh quote. The displayed total comes from the server, and the quoteId
  // is what we pass to /create-intent. No local price math.

  const fetchQuoteRef = useRef<AbortController | null>(null)

  const refreshQuote = useCallback(async (data: BookingData, promo: PromoResult | null): Promise<ServerQuote | null> => {
    // Cancel any in-flight request so a fast input change doesn't race
    fetchQuoteRef.current?.abort()
    const controller = new AbortController()
    fetchQuoteRef.current = controller

    const { customerTypeRates, customerTypeRatePk } = buildCustomerTypeRates(data)

    if (!customerTypeRatePk) {
      setQuoteError('Booking is missing a customer type — please go back and re-select.')
      return null
    }

    setQuoteLoading(true)
    setQuoteError(null)
    try {
      const res = await fetch('/api/booking-flow/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          listingId: data.listingId,
          availPk: data.selectedSlot.pk,
          customerTypeRatePk,
          customerTypeRates,
          guestCount: data.guests,
          category: data.category,
          durationMinutes: data.durationMinutes ?? data.selectedCustomerType?.durationMinutes ?? 90,
          // Recover IDs from extrasCalculation line_items if selectedExtraIds is empty
          // (defensive — JSON.stringify can drop undefined; older sessions may have arrays out of sync)
          selectedExtraIds: (data.selectedExtraIds ?? []).length > 0
            ? data.selectedExtraIds
            : (data.extrasCalculation?.line_items?.map(li => li.extra_id).filter(Boolean) ?? []),
          extraQuantities: Object.keys(data.extraQuantities ?? {}).length > 0
            ? data.extraQuantities
            : Object.fromEntries(
                (data.extrasCalculation?.line_items ?? []).map(li => [li.extra_id, li.quantity])
              ),
          promoCodeId: promo?.promoCodeId,
          discountAmountCents: promo?.discountAmountCents,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setQuoteError(json.error ?? 'Could not generate price quote.')
        setQuote(null)
        return null
      }
      const fresh = json.data as ServerQuote
      setQuote(fresh)
      return fresh
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null
      setQuoteError(getErrorMessage(err))
      setQuote(null)
      return null
    } finally {
      if (!controller.signal.aborted) setQuoteLoading(false)
    }
  }, [])

  // Initial quote when bookingData first loads
  useEffect(() => {
    if (!bookingData) return
    refreshQuote(bookingData, promoResult)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingData])

  // Re-quote when promo changes
  useEffect(() => {
    if (!bookingData) return
    refreshQuote(bookingData, promoResult)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoResult?.promoCodeId, promoResult?.discountAmountCents])

  // Create PaymentIntent after guest info is submitted
  async function handleGuestInfoSubmit(details: CustomerDetails & { partnerCode?: string }) {
    if (isPartnerInvoice) {
      if (!promoResult?.isFull) {
        setError('Please enter your booking code above to proceed.')
        return
      }
      await handleFullDiscountBooking(details, 'partner_invoice')
      return
    }
    if (!bookingData) return
    if (!quote) {
      setError('Your price quote is still loading — please try again in a moment.')
      return
    }
    trackEvent('view_payment', { listing: bookingData.listingSlug })
    setContact(details)
    // Persist contact for iDEAL redirect recovery (component re-mounts after bank redirect)
    sessionStorage.setItem(SESSION_CONTACT_KEY, JSON.stringify(details))

    // Full-discount path: skip Stripe and book directly
    if (promoResult?.isFull) {
      await handleFullDiscountBooking(details)
      return
    }

    setCreatingIntent(true)
    setError(null)

    try {
      // Refresh the quote one final time before charging — guarantees the
      // quoteId we send is fresh and matches the displayed total.
      const currentQuote = await refreshQuote(bookingData, promoResult)
      if (!currentQuote) {
        throw new Error('Could not finalise your price. Please refresh and try again.')
      }

      const res = await fetch('/api/booking-flow/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: currentQuote.quoteId,
          listingTitle: bookingData.listingTitle,
          date: bookingData.date,
          startAt: bookingData.selectedSlot?.startAt ?? null,
          endAt: bookingData.selectedSlot?.endAt ?? null,
          contact: { name: details.name, email: details.email, phone: details.phone },
          sessionId: getSessionId(),
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

  // Full-discount: no Stripe, call book API directly. 'complimentary' matches the
  // canonical BOOKING_SOURCES value (not an ad-hoc 'partner' string) — the server
  // independently re-validates the promo code is a genuine discount_type:'full'
  // comp code before authorizing without an admin session (2026-07 fix).
  async function handleFullDiscountBooking(details: CustomerDetails, bookingSource: 'complimentary' | 'partner_invoice' = 'complimentary') {
    if (!bookingData || !promoResult) return
    setCreatingIntent(true)
    setError(null)
    try {
      const fresh = await refreshQuote(bookingData, promoResult)
      const { customerTypeRates, customerTypeRatePk } = buildCustomerTypeRates(bookingData)

      const extrasTotalCents = fresh?.extrasCalculation.extras_amount_cents
        ?? bookingData.extrasCalculation?.extras_amount_cents
        ?? 0

      const res = await fetch('/api/booking-flow/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availPk: bookingData.selectedSlot.pk,
          customerTypeRatePk,
          customerTypeRates,
          guestCount: bookingData.guests,
          category: bookingData.category,
          contact: details,
          note: details.specialRequests || undefined,
          listingId: bookingData.listingId,
          listingTitle: bookingData.listingTitle,
          date: bookingData.date,
          startAt: bookingData.selectedSlot.startAt,
          endAt: bookingData.selectedSlot.endAt,
          amountCents: 0,
          baseAmountCents: bookingData.basePriceCents,
          extrasAmountCents: extrasTotalCents,
          extrasSelected: bookingData.extrasCalculation?.line_items ?? [],
          bookingSource,
          promoCodeId: promoResult.promoCodeId,
          discountAmountCents: promoResult.discountAmountCents,
          sessionId: getSessionId(),
        }),
      })
      const result = await res.json()
      if (!result.ok) {
        setError('Booking could not be completed. Please contact us at info@offcourseamsterdam.com')
        return
      }
      trackEvent('booking_completed', { listing: bookingData.listingSlug, promo: 'full' })
      sessionStorage.removeItem(SESSION_BOOKING_KEY)
      sessionStorage.removeItem(SESSION_CONTACT_KEY)
      // Pass the FareHarbor UUID so the confirmation page can look up and display
      // the full booking details. Falls back to ?promo=full if somehow missing.
      const fhUuid = result.data?.booking?.uuid
      window.location.href = fhUuid
        ? `/book/${bookingData.listingSlug}/confirmation?fh=${fhUuid}`
        : `/book/${bookingData.listingSlug}/confirmation?promo=full`
    } catch {
      setError('Something went wrong. Please contact us at info@offcourseamsterdam.com')
    } finally {
      setCreatingIntent(false)
    }
  }

  // After Stripe payment succeeds, hand off to the polling confirmation page.
  // The Stripe webhook is the SOLE finalizer now — the browser no longer creates the
  // booking, so there's no /book or /recover race to run. This is identical for card
  // and iDEAL/Link: the confirmation page polls until the webhook writes + confirms
  // the booking (or, after a minute, shows a reassuring "your payment is safe" note).
  async function handlePaymentSuccess(paymentIntentId: string) {
    // Resolve the listing slug from sessionStorage (survives a card payment) or React
    // state, falling back to the prop if both were cleared by the iDEAL bank redirect.
    let slug = listingSlug
    const stored = sessionStorage.getItem(SESSION_BOOKING_KEY)
    if (stored) {
      try { slug = (JSON.parse(stored) as BookingData).listingSlug ?? listingSlug } catch { /* ignore */ }
    } else if (bookingData?.listingSlug) {
      slug = bookingData.listingSlug
    }
    trackEvent('booking_completed', { listing: slug, payment_intent: paymentIntentId })
    sessionStorage.removeItem(SESSION_BOOKING_KEY)
    sessionStorage.removeItem(SESSION_CONTACT_KEY)
    window.location.href = `/book/${slug}/confirmation?payment_intent=${paymentIntentId}`
  }

  // iDEAL return: block the whole checkout UI while the booking is finalised in
  // the background — otherwise the customer briefly sees the payment form again
  // and could try to pay twice.
  if (recovering) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 sm:py-24 text-center">
        <div className="bg-white rounded-2xl shadow-lg p-8 sm:p-10">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)] mx-auto mb-4" />
          <h2 className="text-lg font-bold text-zinc-900 mb-2">Finalising your payment…</h2>
          <p className="text-sm text-zinc-500">
            We&apos;re confirming your booking with the bank. This usually takes a few
            seconds — please don&apos;t close this page.
          </p>
        </div>
      </div>
    )
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

  // Per-type ticket breakdown for the checkout summary (adult × N, child × N).
  // Plain derivation — must stay below the early returns above, so NOT a hook.
  const ticketBreakdown = bookingData.category === 'shared' && bookingData.selectedSlot
    ? bookingData.selectedSlot.customerTypes
        .filter(ct => (bookingData.ticketCounts?.[ct.customerTypePk] ?? 0) > 0)
        .map(ct => ({
          label: ct.name || 'Adult',
          count: bookingData.ticketCounts[ct.customerTypePk],
          priceCents: ct.priceCents,
        }))
    : undefined
  // Prefer the hero image chosen on the virtual listing (what the customer
  // actually browsed), falling back to the boat's stock photo only if unset.
  const boatImageUrl = bookingData.listingHeroImageUrl ?? boat?.imageUrl ?? null

  const cruiseLabel = boatName && bookingData.selectedCustomerType
    ? `${boatName} · ${Math.floor(bookingData.selectedCustomerType.durationMinutes / 60)}h`
    : 'Cruise'

  // Server-canonical price quote drives EVERY displayed total. If the quote
  // hasn't loaded yet we fall back to the snapshot from sessionStorage just
  // for an instant render, but submission is gated on `quote` being set.
  const quoteBasePriceCents = quote?.serverBaseAmountCents ?? bookingData.basePriceCents
  const quoteExtrasCalc = quote?.extrasCalculation ?? bookingData.extrasCalculation
  const cityTaxCents = quote?.cityTaxCents ?? bookingData.cityTaxCents ?? 0
  const discountAmountCents = quote?.discountAmountCents ?? promoResult?.discountAmountCents ?? 0
  const grossTotalCents =
    quoteBasePriceCents + (quoteExtrasCalc?.extras_amount_cents ?? 0) + cityTaxCents
  const totalAmountCents = quote?.totalCents ?? Math.max(0, grossTotalCents - discountAmountCents)

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
        {/* Test-mode banner — visible only when NEXT_PUBLIC_STRIPE_MODE=test */}
        {stripeIsTestMode && (
          <div className="mb-6 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-2.5 text-sm text-yellow-800 font-medium flex items-center gap-2">
            🧪 <span><strong>Stripe test mode</strong> — use card <code className="font-mono bg-yellow-100 px-1 rounded">4242 4242 4242 4242</code>, any future expiry, any CVC. No real charges.</span>
          </div>
        )}

        {/* Progress indicator */}
        <CheckoutProgress step={currentStep} hidePayment={isPartnerInvoice || (promoResult?.isFull ?? false)} />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12">
          {/* Left column: promo + form + payment */}
          <div className="lg:col-span-3 overflow-hidden">

            {/* Promo / booking code input */}
            {!clientSecret && (
              <div className="mb-6">
                <PromoCodeInput
                  grandTotalCents={grossTotalCents}
                  baseAmountCents={bookingData?.basePriceCents ?? 0}
                  cityTaxCents={bookingData?.cityTaxCents ?? 0}
                  initialCode={initialCode}
                  applied={promoResult}
                  onApplied={setPromoResult}
                  onRemoved={() => setPromoResult(null)}
                  required={isPartnerInvoice}
                  listingId={bookingData?.listingId}
                />
              </div>
            )}

            <AnimatePresence mode="popLayout" initial={false}>
              {!clientSecret ? (
                <motion.div
                  key="details"
                  initial={{ x: 0, opacity: 1 }}
                  exit={{ x: '-100%', opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                >
                  {isPartnerInvoice && (
                    <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                      <strong className="block">No payment today 🤝</strong>
                      This booking is settled with {partnerName ?? 'the partner'} — you&apos;ve already paid them at the desk.
                    </div>
                  )}
                  {bookingData.selectedExtraIds.length === 0 && (
                    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <strong className="block mb-1">No extras selected</strong>
                      Looks like you haven&apos;t added any food or drinks.{' '}
                      <a href={`/cruises/${listingSlug}`} className="underline font-medium">
                        Go back to add extras
                      </a>{' '}
                      or continue below if that&apos;s intentional.
                    </div>
                  )}
                  <GuestInfoForm
                    onSubmit={handleGuestInfoSubmit}
                    loading={creatingIntent || submittingPartnerBooking}
                    submitLabel={isPartnerInvoice ? 'Confirm booking' : undefined}
                  />
                  {error && isPartnerInvoice && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mt-4">
                      {error}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="payment"
                  initial={{ x: '100%', opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                >
                  <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
                    <PaymentStep
                      amountCents={totalAmountCents}
                      onSuccess={handlePaymentSuccess}
                      bookingData={bookingData}
                    />
                  </Elements>
                </motion.div>
              )}
            </AnimatePresence>

            {error && !isPartnerInvoice && (
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
                basePriceCents={quoteBasePriceCents}
                extrasCalculation={quoteExtrasCalc}
                cityTaxCents={cityTaxCents > 0 ? cityTaxCents : undefined}
                cruiseLabel={cruiseLabel}
                discountAmountCents={discountAmountCents > 0 ? discountAmountCents : undefined}
                ticketBreakdown={ticketBreakdown}
              />
              {/* Cancellation cutoff card — only shown when there's a useful upcoming deadline (full or 50% refund). */}
              {cancellationTiers && cancellationTiers.length > 0 && bookingData.selectedSlot.startAt && (
                <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4 mt-3">
                  <CancellationCutoff
                    departureAt={new Date(bookingData.selectedSlot.startAt)}
                    tiers={cancellationTiers}
                    bordered={false}
                  />
                </div>
              )}
              {quoteLoading && (
                <p className="text-xs text-zinc-400 mt-2 text-center">Refreshing your total…</p>
              )}
              {quoteError && (
                <p className="text-xs text-red-500 mt-2 text-center">{quoteError}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
