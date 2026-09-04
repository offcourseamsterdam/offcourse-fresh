'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
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
import type { BusinessDetails } from '@/components/admin/fareharbor/BusinessDetailsPanel'
import type { ExtrasCalculation } from '@/lib/extras/calculate'
import { BOOKING_SOURCES } from '@/lib/constants'
import type { BookingSource } from '@/lib/constants'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { toAmsDateStr } from '@/lib/utils'

// Declare gtag so TypeScript doesn't complain
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function BookingFlowPage() {
  const today = toAmsDateStr()
  const searchParams = useSearchParams()

  // Step state
  const [step, setStep] = useState(1)

  // Booking source (determines whether Stripe is used)
  const [bookingSource, setBookingSource] = useState<BookingSource>('website')
  const [depositAmountCents, setDepositAmountCents] = useState(0)
  const [depositInput, setDepositInput] = useState('0')
  // Stripe recovery: real amount paid + optional PI ID to cross-reference
  const [recoveryAmountInput, setRecoveryAmountInput] = useState('')
  const [recoveryStripePiInput, setRecoveryStripePiInput] = useState('')
  // When FareHarbor rejects due to minimum party size (e.g. solo booking on shared cruise),
  // this lets you bypass the FH API and record the revenue locally only.
  // You then create the booking manually in FareHarbor admin.
  const [overrideMinParty, setOverrideMinParty] = useState(false)

  // "Invoice later" — admin picks an existing partner directly (no code needed,
  // unlike the public Webikeamsterdam QR checkout). The suggested invoice
  // amount is fetched from the server (uses an active campaign's commission %
  // when one exists for this partner+listing) but is always editable.
  const { data: partnersData, isLoading: partnersLoading } = useAdminFetch<{ partners: { id: string; name: string }[] }>(
    bookingSource === 'invoice_later' ? '/api/admin/partners' : null
  )
  const partners = partnersData?.partners ?? []
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('')
  const [invoiceAmountInput, setInvoiceAmountInput] = useState('')
  const [invoiceSuggestionNote, setInvoiceSuggestionNote] = useState<string | null>(null)

  // Step 1
  const [date, setDate] = useState(today)
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null)

  // Step 2
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null)
  const [guestCount, setGuestCount] = useState(2)
  // For shared cruises: per-ticket-type counts (ratePk → count)
  const [ticketCounts, setTicketCounts] = useState<Record<number, number>>({})

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
  const [stripeInvoiceUrl, setStripeInvoiceUrl] = useState<string | null>(null)

  // Stripe Invoice (Op Factuur)
  const [businessDetails, setBusinessDetails] = useState<BusinessDetails>({
    companyName: '',
    kvkNumber: '',
    vatNumber: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    addressLine1: '',
    postalCode: '',
    city: '',
    countryCode: 'NL',
  })

  const isInternal = bookingSource !== 'website'
  const isStripeRecovery = bookingSource === 'stripe_recovery'
  const isInvoiceLater = bookingSource === 'invoice_later'
  const isStripeInvoice = bookingSource === 'stripe_invoice'

  // Sync deposit input when source changes
  useEffect(() => {
    if (bookingSource === 'complimentary') {
      setDepositAmountCents(0)
      setDepositInput('0')
    }
    // Reset recovery fields when leaving stripe_recovery
    if (bookingSource !== 'stripe_recovery') {
      setRecoveryAmountInput('')
      setRecoveryStripePiInput('')
    }
    // Reset invoice-later fields when leaving that source
    if (bookingSource !== 'invoice_later') {
      setSelectedPartnerId('')
      setInvoiceAmountInput('')
      setInvoiceSuggestionNote(null)
    }
    // Reset business details when leaving stripe_invoice
    if (bookingSource !== 'stripe_invoice') {
      setBusinessDetails({
        companyName: '',
        kvkNumber: '',
        vatNumber: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        addressLine1: '',
        postalCode: '',
        city: '',
        countryCode: 'NL',
      })
    }
  }, [bookingSource])

  // Pre-fill from an OTA "create booking" link (ContextPane's OtaBookingReadyCard)
  // — a Withlocals/GetMyBoat guest already paid on the platform, so this is
  // just saving Beer from re-typing what the confirmation email already gave
  // us. Deliberately does NOT touch the listing/slot/rate selection (step 1-2)
  // — that still requires picking the real FareHarbor availability by hand,
  // same as any other booking. Runs once on mount only (an intentionally
  // empty dependency array): this is a one-time deep-link prefill, not a
  // live sync with the URL — the admin should be free to edit any field
  // afterward without it snapping back.
  useEffect(() => {
    const otaPlatform = searchParams.get('otaPlatform')
    if (!otaPlatform) return
    const otaSource = otaPlatform === 'withlocals' ? 'withlocals' : 'complimentary'
    setBookingSource(otaSource)
    const date = searchParams.get('date')
    if (date) setDate(date)
    const guests = Number(searchParams.get('guests'))
    if (guests > 0) setGuestCount(guests)
    const guestName = searchParams.get('guestName')
    const otaRef = searchParams.get('otaRef')
    setContact(c => ({
      ...c,
      name: guestName ?? c.name,
      note: otaRef
        ? `${otaPlatform} booking ref ${otaRef} — guest already paid on the platform, no direct contact details available.`
        : c.note,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pre-fill recovery amount with the calculated grand total when entering step 5
  useEffect(() => {
    if (step === 5 && isStripeRecovery && !recoveryAmountInput) {
      const calc = extrasStep?.calculation
      const baseCents = selectedRate ? (ratePrice(selectedRate) ?? 0) : 0
      const totalCents = calc
        ? calc.grand_total_cents + (guestCount * 260) // include city tax
        : baseCents + (guestCount * 260)
      if (totalCents > 0) {
        setRecoveryAmountInput((totalCents / 100).toFixed(2))
      }
    }
  }, [step, isStripeRecovery, recoveryAmountInput, extrasStep, selectedRate, guestCount])

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
    setTicketCounts({})
  }

  function handleTicketCountChange(ratePk: number, count: number) {
    setTicketCounts(prev => ({ ...prev, [ratePk]: count }))
  }

  // For shared cruises, derive guestCount and selectedRate from ticketCounts.
  // selectedRate stays null for shared — booking creation uses customerTypeRates instead.
  const isSharedListing = selectedListing?.category === 'shared'
  const effectiveGuestCount = isSharedListing
    ? Object.values(ticketCounts).reduce((s, c) => s + c, 0)
    : guestCount

  // For shared: build the customerTypeRates array for the book endpoint
  const customerTypeRates = isSharedListing && selectedSlot
    ? selectedSlot.customer_type_rates
        .filter(r => (ticketCounts[r.pk] ?? 0) > 0)
        .map(r => ({ pk: r.pk, count: ticketCounts[r.pk] }))
    : undefined

  // For shared: primary rate = first non-zero ticket type (used for ExtrasStep baseAmount)
  const primarySharedRate = isSharedListing && selectedSlot
    ? selectedSlot.customer_type_rates.find(r => (ticketCounts[r.pk] ?? 0) > 0) ?? null
    : null

  // Base amount in cents for the booking
  const sharedBaseAmountCents = isSharedListing && selectedSlot
    ? selectedSlot.customer_type_rates.reduce((sum, r) => {
        const count = ticketCounts[r.pk] ?? 0
        const price = ratePrice(r) ?? 0
        return sum + price * count
      }, 0)
    : null

  // Suggested invoice amount — only fetched once a partner + listing are both
  // known AND the admin hasn't already typed an amount (the `!invoiceAmountInput`
  // guard below is what makes this "pre-fill only, never overwrite typed input":
  // once invoiceAmountInput is set, the URL collapses to null and useAdminFetch
  // stops fetching entirely, so it can never come back and clobber a manual edit).
  const invoiceSuggestionActiveRate = isSharedListing ? primarySharedRate : selectedRate
  const invoiceSuggestionBaseCents =
    extrasStep?.calculation?.base_amount_cents ??
    (isSharedListing
      ? (sharedBaseAmountCents ?? 0)
      : (invoiceSuggestionActiveRate ? ratePrice(invoiceSuggestionActiveRate) ?? 0 : 0))

  const invoiceSuggestionUrl =
    isInvoiceLater && step === 5 && selectedPartnerId && selectedListing && !invoiceAmountInput && invoiceSuggestionBaseCents > 0
      ? `/api/admin/booking-flow/invoice-suggestion?partnerId=${selectedPartnerId}&listingId=${selectedListing.id}&baseAmountCents=${invoiceSuggestionBaseCents}`
      : null

  const { data: invoiceSuggestionData, isLoading: invoiceSuggestionLoading } = useAdminFetch<{
    suggestedInvoiceCents: number
    hasCampaign: boolean
    commissionPercent: number | null
  }>(invoiceSuggestionUrl)

  // Layered on top of the hook: applying the fetched suggestion to form state
  // isn't something the hook itself can do — it just fetches. The "don't
  // overwrite" guard lives in invoiceSuggestionUrl above; this effect only
  // runs the one time fresh data actually arrives.
  useEffect(() => {
    if (!invoiceSuggestionData) return
    setInvoiceAmountInput((invoiceSuggestionData.suggestedInvoiceCents / 100).toFixed(2))
    setInvoiceSuggestionNote(
      invoiceSuggestionData.hasCampaign
        ? `Suggested from an active ${invoiceSuggestionData.commissionPercent}% commission campaign — edit if needed.`
        : 'No active campaign for this partner + listing — defaulted to the full amount. Edit if needed.'
    )
  }, [invoiceSuggestionData])

  // ── Step 4 → 5: Extras confirmed ────────────────────────────────────────

  async function handleExtrasContinue(selectedExtraIds: string[], calculation: ExtrasCalculation) {
    const activeRate = isSharedListing ? primarySharedRate : selectedRate
    if (!selectedSlot || !activeRate || !selectedListing) return
    setExtrasStep({ selectedExtraIds, calculation })

    if (bookingSource === 'payment_link') {
      setStep(5)
      return
    }

    if (isInternal) {
      setStep(5)
      return
    }

    // Website booking: create_intent requires a server-issued quoteId (same
    // contract as the public checkout) — fetch that quote first, then charge it.
    setCreatingIntent(true)
    setIntentError(null)

    const durationMinutes = Math.round(
      (new Date(selectedSlot.end_at).getTime() - new Date(selectedSlot.start_at).getTime()) / 60_000
    )
    const extraQuantities = Object.fromEntries(
      calculation.line_items.map(li => [li.extra_id, li.quantity])
    )

    try {
      const quoteRes = await fetch('/api/booking-flow/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: selectedListing.id,
          availPk: selectedSlot.pk,
          customerTypeRatePk: activeRate.pk,
          customerTypeRates,
          guestCount: effectiveGuestCount,
          category: selectedListing.category,
          durationMinutes,
          selectedExtraIds,
          extraQuantities,
        }),
      })
      const quoteJson = await quoteRes.json()
      if (!quoteJson.ok) {
        setIntentError(quoteJson.error ?? 'Could not generate price quote')
        return
      }

      const res = await fetch('/api/admin/booking-flow/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: quoteJson.data.quoteId,
          listingTitle: selectedListing.title,
          date,
          startAt: selectedSlot.start_at,
          endAt: selectedSlot.end_at,
          contact: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
          },
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setClientSecret(json.data.clientSecret)
        setGrandTotalCents(json.data.chargedCents ?? null)
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
    const activeRate = isSharedListing ? primarySharedRate : selectedRate
    if (!selectedSlot || !activeRate || !selectedListing) return
    const calc = extrasStep?.calculation ?? null
    const baseAmountCents = isSharedListing
      ? (sharedBaseAmountCents ?? 0)
      : (ratePrice(activeRate) ?? 0)

    const recoveryCents = Math.round((parseFloat(recoveryAmountInput) || 0) * 100)
    const stripeInvoiceCents = calc
      ? calc.grand_total_cents + (effectiveGuestCount * 260)
      : baseAmountCents + (effectiveGuestCount * 260)

    setBookingLoading(true)
    setBookingError(null)
    setStep(6)

    try {
      const res = await fetch('/api/admin/booking-flow/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availPk: selectedSlot.pk,
          customerTypeRatePk: activeRate.pk,
          customerTypeRates,
          guestCount: effectiveGuestCount,
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
          amountCents: isStripeRecovery ? recoveryCents : isStripeInvoice ? stripeInvoiceCents : 0,
          baseAmountCents: calc?.base_amount_cents ?? baseAmountCents,
          extrasSelected: calc?.line_items ?? [],
          extrasAmountCents: calc?.extras_amount_cents ?? 0,
          extrasVatAmountCents: calc?.extras_vat_amount_cents ?? 0,
          baseVatAmountCents: calc?.base_vat_amount_cents ?? 0,
          totalVatAmountCents: calc?.total_vat_amount_cents ?? 0,
          bookingSource,
          depositAmountCents,
          // Stripe recovery only — links the manually-entered booking to the original PI
          recoveryStripePaymentIntentId: isStripeRecovery
            ? (recoveryStripePiInput.trim() || null)
            : null,
          // Skip FareHarbor booking creation and record revenue locally only.
          // Use when FH rejects due to minimum party size — create in FH admin manually.
          overrideMinParty: isStripeRecovery ? overrideMinParty : false,
          // Invoice later only — which partner to invoice + the final (possibly
          // admin-edited) amount. Server derives commission_amount_cents from it.
          partnerId: isInvoiceLater ? selectedPartnerId : undefined,
          invoiceAmountCents: isInvoiceLater
            ? Math.round((parseFloat(invoiceAmountInput) || 0) * 100)
            : undefined,
          // Stripe Invoice (Op Factuur) business details
          businessDetails: isStripeInvoice ? businessDetails : undefined,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setBooking(json.booking)
        if (json.invoice?.hostedInvoiceUrl) {
          setStripeInvoiceUrl(json.invoice.hostedInvoiceUrl)
        } else if (json.booking?.stripe_invoice_url) {
          setStripeInvoiceUrl(json.booking.stripe_invoice_url)
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

  // ── Step 5 → 6: Create FH booking after Stripe payment succeeds ─────────

  async function handlePaymentSuccess(piId: string) {
    const activeRate = isSharedListing ? primarySharedRate : selectedRate
    if (!selectedSlot || !activeRate || !selectedListing) return
    await createFHBooking(piId, {
      availPk: selectedSlot.pk,
      customerTypeRatePk: activeRate.pk,
      customerTypeRates,
      guestCount: effectiveGuestCount,
      category: selectedListing.category,
      contact,
      selectedListing,
      selectedSlot,
      selectedRate: activeRate,
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
          customerTypeRates: payload.customerTypeRates,
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
    setTicketCounts({})
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
    setOverrideMinParty(false)
    setSelectedPartnerId('')
    setInvoiceAmountInput('')
    setInvoiceSuggestionNote(null)
    setStripeInvoiceUrl(null)
    setBusinessDetails({
      companyName: '',
      kvkNumber: '',
      vatNumber: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      addressLine1: '',
      postalCode: '',
      city: '',
      countryCode: 'NL',
    })
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
          {BOOKING_SOURCES.filter(src => src.adminSelectable).map(src => (
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
          ticketCounts={ticketCounts}
          onBack={() => setStep(1)}
          onPickSlot={pickSlot}
          onPickRate={setSelectedRate}
          onGuestCountChange={setGuestCount}
          onTicketCountChange={handleTicketCountChange}
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
          bookingSource={bookingSource}
          businessDetails={businessDetails}
          onBusinessDetailsChange={setBusinessDetails}
          onBack={() => setStep(2)}
          onContinue={() => setStep(4)}
        />
      )}

      {step === 4 && selectedListing && (isSharedListing ? !!primarySharedRate : !!selectedRate) && (
        <ExtrasStepPanel
          listing={selectedListing}
          rate={(isSharedListing ? primarySharedRate : selectedRate)!}
          guestCount={effectiveGuestCount}
          creatingIntent={creatingIntent}
          intentError={intentError}
          onContinue={handleExtrasContinue}
          onBack={() => setStep(3)}
        />
      )}

      {/* Step 5 — Website: Stripe payment */}
      {step === 5 && !isInternal && clientSecret && (isSharedListing ? !!primarySharedRate : !!selectedRate) && selectedListing && selectedSlot && (
        <PaymentStep
          clientSecret={clientSecret}
          selectedListing={selectedListing}
          selectedSlot={selectedSlot}
          selectedRate={(isSharedListing ? primarySharedRate : selectedRate)!}
          guestCount={effectiveGuestCount}
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
            <h3 className="font-semibold text-zinc-900">
              {isStripeRecovery ? 'Confirm booking — already paid' : 'Confirm internal booking'}
            </h3>

            {/* Source reminder */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Source:</span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isStripeRecovery
                  ? 'bg-amber-100 text-amber-700'
                  : isInvoiceLater
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-purple-100 text-purple-700'
              }`}>
                {BOOKING_SOURCES.find(s => s.value === bookingSource)?.label ?? bookingSource}
              </span>
            </div>

            {/* Invoice later — pick partner + confirm amount to invoice */}
            {isInvoiceLater && (
              <>
                <div className="rounded-md bg-indigo-50 border border-indigo-200 px-4 py-3 text-xs text-indigo-900">
                  No payment is taken now. Pick the partner this booking will be invoiced to —
                  the suggested amount below comes from an active campaign&apos;s commission %, if
                  one exists for this partner + listing, or defaults to the full price.
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700">Partner</label>
                  <select
                    value={selectedPartnerId}
                    onChange={e => {
                      setSelectedPartnerId(e.target.value)
                      setInvoiceAmountInput('') // let the suggestion effect re-fill for the new partner
                    }}
                    disabled={partnersLoading}
                    className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
                  >
                    <option value="">{partnersLoading ? 'Loading partners…' : 'Select a partner…'}</option>
                    {partners.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700">Amount to invoice (€)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoiceAmountInput}
                    onChange={e => setInvoiceAmountInput(e.target.value)}
                    disabled={!selectedPartnerId}
                    className="block w-48 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
                    placeholder="0.00"
                  />
                  {invoiceSuggestionLoading && (
                    <p className="text-xs text-zinc-400">Calculating suggested amount…</p>
                  )}
                  {!invoiceSuggestionLoading && invoiceSuggestionNote && (
                    <p className="text-xs text-zinc-400">{invoiceSuggestionNote}</p>
                  )}
                </div>
              </>
            )}

            {/* Stripe recovery fields */}
            {isStripeRecovery && (
              <>
                <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900">
                  Use this when Stripe took the payment but the booking flow failed.
                  The amount below is recorded as paid revenue. No Stripe charge is made now.
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700">
                    Amount paid (€)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={recoveryAmountInput}
                    onChange={e => setRecoveryAmountInput(e.target.value)}
                    className="block w-48 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-zinc-400">Pre-filled with the calculated total (incl. city tax + extras). Adjust if the actual amount paid differs.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700">
                    Stripe Payment Intent ID <span className="text-zinc-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={recoveryStripePiInput}
                    onChange={e => setRecoveryStripePiInput(e.target.value)}
                    className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-900"
                    placeholder="pi_3O…"
                  />
                  <p className="text-xs text-zinc-400">Paste the original Stripe PI ID to cross-reference. Leave empty if unknown.</p>
                </div>

                {/* Override minimum party size */}
                <label className="flex items-start gap-3 cursor-pointer select-none rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 hover:bg-zinc-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={overrideMinParty}
                    onChange={e => setOverrideMinParty(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-zinc-900"
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-800">Override minimum party size</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Skip FareHarbor booking creation and record revenue locally only.
                      Use when FH rejects due to party size (e.g. solo on shared cruise).
                      You&apos;ll need to create the booking manually in FareHarbor admin.
                    </p>
                  </div>
                </label>
              </>
            )}

            {/* Stripe Invoicing (Op Factuur) */}
            {isStripeInvoice && (
              <>
                <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-900 space-y-1">
                  <p className="font-semibold text-emerald-950">
                    Stripe Factuur & Reservering
                  </p>
                  <p>
                    De boeking wordt direct gereserveerd in FareHarbor en de officiële factuur wordt per e-mail verstuurd naar <strong>{contact.email || businessDetails.contactEmail}</strong> via Stripe.
                  </p>
                  <p className="pt-1 text-emerald-800">
                    📅 Betaaltermijn: <strong>14 dagen na de vaart</strong> (inclusief Virtual IBAN auto-reconciliatie).
                  </p>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Bedrijf:</span>
                    <span className="font-semibold text-zinc-900">{businessDetails.companyName}</span>
                  </div>
                  {businessDetails.kvkNumber && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">KVK:</span>
                      <span className="text-zinc-900 font-mono">{businessDetails.kvkNumber}</span>
                    </div>
                  )}
                  {businessDetails.vatNumber && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">BTW:</span>
                      <span className="text-zinc-900 font-mono">{businessDetails.vatNumber}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Adres:</span>
                    <span className="text-zinc-900">{businessDetails.addressLine1}, {businessDetails.postalCode} {businessDetails.city}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-zinc-200 font-medium">
                    <span className="text-zinc-700">Totaal factuurbedrag:</span>
                    <span className="text-zinc-900 font-semibold text-sm">
                      €{(((extrasStep?.calculation?.grand_total_cents ?? (isSharedListing ? (sharedBaseAmountCents ?? 0) : (selectedRate ? ratePrice(selectedRate) ?? 0 : 0))) + (effectiveGuestCount * 260)) / 100).toFixed(2)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Deposit amount field — hidden for complimentary, stripe_recovery, invoice_later, stripe_invoice */}
            {bookingSource !== 'complimentary' && !isStripeRecovery && !isInvoiceLater && !isStripeInvoice && (
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
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  {isStripeInvoice ? 'Geselecteerde Extras (op factuur)' : 'Extras (informational — not charged)'}
                </p>
                {extrasStep.calculation.line_items.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-zinc-600">{item.name}</span>
                    <span className={isStripeInvoice ? 'text-zinc-900 font-medium' : 'text-zinc-400 line-through'}>
                      €{(item.amount_cents / 100).toFixed(2)}
                    </span>
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
              disabled={
                (isStripeRecovery && !recoveryAmountInput) ||
                (isInvoiceLater && (!selectedPartnerId || !invoiceAmountInput)) ||
                (isStripeInvoice && (!businessDetails.companyName || !businessDetails.addressLine1 || !businessDetails.postalCode || !businessDetails.city))
              }
              className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm font-semibold hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isStripeRecovery
                ? 'Confirm — already paid'
                : isInvoiceLater
                  ? 'Confirm — invoice later'
                  : isStripeInvoice
                    ? 'Boeken & Factuur Versturen via Stripe 📄'
                    : 'Confirm Booking'}
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
          stripeInvoiceUrl={stripeInvoiceUrl}
          onReset={reset}
        />
      )}
    </div>
  )
}
