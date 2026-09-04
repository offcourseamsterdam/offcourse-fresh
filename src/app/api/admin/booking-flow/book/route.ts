import { NextRequest, after } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import type { FHBookingResponse } from '@/lib/fareharbor/types'
import { resolveCustomerTypeName, describeCustomerTypes } from '@/lib/fareharbor/customer-type-name'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'
import type { BookingSource } from '@/lib/constants'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getOrCreateStripeCustomer, createAndSendStripeInvoice, voidStripeInvoice, type StripeInvoiceResult } from '@/lib/stripe/invoicing'
import { validatePromoCodeById } from '@/lib/promo-codes/validate'
import { normalizePartnerCode } from '@/lib/partner-codes/generate'
import { validatePartnerCode, reasonMessage } from '@/lib/partner-codes/validate'
import { sendConfirmationEmail } from '@/lib/booking/send-confirmation-email'
import { notifyCateringOrder } from '@/lib/catering/notify'
import { hasFood } from '@/lib/catering/filter'
import { isWithinCateringAutoSendWindow } from '@/lib/catering/auto-send-cutoff'
import { sendCateringOrderEmailForBooking } from '@/lib/catering/send-catering-email'
import { notifyBookingFailure } from '@/lib/booking/notify-booking-failure'
import { commissionFromInvoiceAmount } from '@/lib/booking/invoice-suggestion'
import { commissionForCampaign } from '@/lib/booking/commission'
import { resolveCampaignCommission } from '@/lib/booking/campaign-commission'
import { parseAttribution } from '@/lib/tracking/attribution'
import { extractVat } from '@/lib/extras/calculate'
import { formatAmsterdamTime, fmtEurosRounded as fmtAmountEur } from '@/lib/utils'
import { postSlackText, postSlackOps, postSlackCritical } from '@/lib/slack/send-notification'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { CITY_TAX_CENTS_PER_GUEST, CRUISE_VAT_RATE, EXTRAS_VAT_RATE } from '@/lib/booking/constants'
import { emitOpsEvent } from '@/lib/ops/events'
import { draftGuestMoveForNewBooking } from '@/lib/ghost/guest-move-drafter'
import { syncAndScheduleShifts } from '@/lib/scheduling/proactive-scheduling'
import type { Json } from '@/lib/supabase/types'

// VAT rates: use the shared constants (src/lib/booking/constants.ts) — every
// booking-creation site (this route, the Stripe webhook, create-payment-link)
// must agree on these, and the invoice PDF already reads them from there too.
const BASE_VAT_RATE_PERCENT: number = CRUISE_VAT_RATE
const DEFAULT_EXTRAS_VAT_RATE_PERCENT: number = EXTRAS_VAT_RATE

/** Booking sources that are paid third-party platforms — eligible for auto campaign attribution
 *  via `resolveCampaignId` when no cookie-based attribution is present. */
const PLATFORM_SOURCES = ['withlocals', 'clickandboat', 'getyourguide', 'tripadvisor'] as const

/**
 * POST /api/admin/booking-flow/book
 *
 * Step 1: validates the booking with FareHarbor.
 * Step 2: if valid, creates the booking.
 * Step 3: saves to Supabase + sends Slack notification + sends confirmation email.
 *
 * Body: {
 *   availPk, customerTypeRatePk, guestCount, category,
 *   contact: { name, phone, email }, note?,
 *   listingId, listingTitle, date, startAt, endAt,
 *   amountCents, stripePaymentIntentId
 *   baseAmountCents: number      — cruise price in cents (base, excl. extras)
 *   selectedExtraIds?: string[]  — IDs of extras the customer selected
 *   extrasSelected?: object[]    — pre-calculated extras snapshot from create-intent
 *   extrasAmountCents?: number
 *   extrasVatAmountCents?: number
 *   baseVatAmountCents?: number
 *   totalVatAmountCents?: number
 *   bookingSource?: BookingSource — defaults to 'website'; non-website skips Stripe
 *   depositAmountCents?: number   — platform deposit (0 for comp, >0 for platforms)
 * }
 *
 * category: 'private' | 'shared'
 *   Private boats: quantity is always 1 regardless of guest count (the rate IS the boat/duration).
 *   Shared boats: quantity = guestCount (each guest is a separate customer entry).
 */
/**
 * Pick which analytics session a booking belongs to.
 *
 * The browsing session captured on the PaymentIntent at intent-creation
 * (`metadata.session_id`) is authoritative — it was recorded while the customer
 * was still browsing. The client-sent `body.sessionId` is read at booking time,
 * AFTER the Stripe payment redirect, so it points at a fresh post-payment session
 * (the "/confirmation" orphan) and would detach the booking from the funnel that
 * actually produced it. Prefer the PI value; fall back to the body value for
 * non-Stripe bookings (full-discount / partner-invoice) that have no PaymentIntent.
 */
export function pickBookingSessionId(
  piMetadataSessionId: string | null | undefined,
  bodySessionId: string | null | undefined,
): string | null {
  return piMetadataSessionId || bodySessionId || null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      availPk, customerTypeRatePk, guestCount, category, contact, note,
      listingId, listingTitle, departureLocation, date, startAt, endAt,
      amountCents, stripePaymentIntentId,
      baseAmountCents, extrasSelected, extrasAmountCents,
      totalVatAmountCents,
      bookingSource = 'website' as BookingSource,
      depositAmountCents,
      partnerCode,
      promoCodeId,
      // "Invoice later" only — admin picks an existing partner directly and
      // confirms (or overrides) the suggested amount to invoice them.
      partnerId: invoicePartnerId,
      invoiceAmountCents,
      // When a shared booking has multiple ticket types (adult + child), this
      // array carries the per-type breakdown so FH records the correct ticket types.
      customerTypeRates,
      // Stripe recovery only: skip FareHarbor validate+create, record revenue locally.
      // Use when FH rejects due to minimum party size — admin creates in FH manually.
      overrideMinParty = false,
    } = body

    if (!availPk || !customerTypeRatePk || !guestCount || !contact?.name || !contact?.email || !contact?.phone) {
      return apiError('Missing required fields: availPk, customerTypeRatePk, guestCount, contact.name, contact.email, contact.phone', 400)
    }

    const isInternal = bookingSource !== 'website'
    const isPartnerInvoice = bookingSource === 'partner_invoice'
    const isStripeRecovery = bookingSource === 'stripe_recovery'
    const isStripeInvoice = bookingSource === 'stripe_invoice'

    if (isStripeInvoice) {
      const bd = body.businessDetails
      if (!bd?.companyName?.trim() || !bd?.addressLine1?.trim() || !bd?.postalCode?.trim() || !bd?.city?.trim()) {
        return apiError('Missing required business details: companyName, addressLine1, postalCode, city', 400)
      }
    }

    // Internal booking sources (partner_invoice, stripe_recovery, withlocals, etc.)
    // bypass Stripe payment verification and create real FareHarbor bookings and
    // consume boat capacity. Gate them behind admin auth so only authenticated admin
    // users can trigger them. Website bookings stay unauthenticated — that's the
    // public customer checkout path.
    //
    // Exception: partner_invoice WITH a code (promoCodeId/partnerCode) is the
    // Webikeamsterdam QR-checkout — an unauthenticated customer at a partner desk,
    // never an admin session. The code itself is the authorization there (validated
    // below by resolvePartnerInvoiceContext, which rejects anything invalid before
    // any booking is created) — same trust model as before this admin gate existed.
    // partner_invoice WITHOUT a code (e.g. an admin picking a partner directly) has
    // no self-proving credential, so it still requires a real admin session.
    const isAuthorizedByPartnerCode = isPartnerInvoice && !!(promoCodeId || partnerCode)
    //
    // Second exception, same shape: an anonymous customer who redeemed a genuine
    // comp code (discount_type:'full') during checkout — CheckoutFlow.tsx sends
    // bookingSource:'complimentary' with the promo id it validated client-side, but
    // the client's word is never trusted for authorization. Re-validate the code for
    // real here (2026-07 fix — the 'complimentary' source previously required an
    // admin session for EVERY caller, including real customers, which was both a
    // functional bug — real customers got a 401 — and, once you consider fixing the
    // functional bug naively, a latent hole: nothing else in this route re-checks a
    // promo code for the non-partner-invoice path, so simply removing the admin gate
    // without this check would let anyone claim any promoCodeId for a free booking).
    // Admin-created complimentary bookings (staff picks it in /admin/fareharbor with
    // no code) have no promoCodeId, so they still fall through to requireAdmin below.
    const isAuthorizedByFullPromo = bookingSource === 'complimentary' && !!promoCodeId &&
      await (async () => {
        const validation = await validatePromoCodeById(String(promoCodeId), { listingId: listingId ?? null })
        return validation.ok && validation.code.discount_type === 'full'
      })()
    if (isInternal && !isAuthorizedByPartnerCode && !isAuthorizedByFullPromo) {
      const denied = await requireAdmin()
      if (denied) return denied
    }

    // ── Partner-invoice branch ─────────────────────────────────────────────
    // Skip Stripe. Validate the listing is actually partner-invoice, validate
    // the partner code, and pull the commission % from the campaign linking
    // this listing + partner. (Webikeamsterdam pattern.)
    const partnerInvoiceResult = await resolvePartnerInvoiceContext({
      isPartnerInvoice,
      listingId: listingId ?? null,
      promoCodeId: promoCodeId ?? null,
      partnerCode: partnerCode ?? null,
    })
    if (!partnerInvoiceResult.ok) {
      return apiError(partnerInvoiceResult.error, partnerInvoiceResult.status)
    }
    const partnerInvoiceContext = partnerInvoiceResult.context

    // ── Invoice-later branch ────────────────────────────────────────────────
    // Admin picked an existing partner directly — no code, no campaign required.
    const invoiceLaterResult = await resolveInvoiceLaterContext({
      isInvoiceLater: bookingSource === 'invoice_later',
      partnerId: (invoicePartnerId as string | null) ?? null,
      baseAmountCents: Number(baseAmountCents ?? 0),
      invoiceAmountCents: invoiceAmountCents != null ? Number(invoiceAmountCents) : null,
    })
    if (!invoiceLaterResult.ok) {
      return apiError(invoiceLaterResult.error, invoiceLaterResult.status)
    }
    const invoiceLaterContext = invoiceLaterResult.context

    // ── Campaign attribution & commission ──────────────────────────────────
    // Resolves to one of four sources, in this precedence (last wins):
    //   1. Cookie (oc_attr) — passive attribution from a tracked visit (website only)
    //   2. Promo code with campaign_id — explicit code-scoped attribution
    //   3. Partner-invoice context — the Webikeamsterdam QR flow
    //   4. Invoice-later context — admin picked the partner directly (highest priority)
    //
    // Cookie attribution is intentionally skipped for non-website sources (GetYourGuide,
    // WithLocals, stripe_recovery, etc.) — those bookings are entered by an admin whose
    // browser may carry a partner cookie unrelated to the actual booking channel.
    // Platform auto-attribution still runs via resolveCampaignId in saveToSupabase.
    const { campaignId: cookieCampaignId, partnerId, commissionAmountCents } = await resolveAttribution({
      attrCookie: bookingSource === 'website' ? (request.cookies.get('oc_attr')?.value ?? null) : null,
      promoCodeId: promoCodeId ?? null,
      partnerInvoiceContext,
      invoiceLaterContext,
      baseAmountCents: Number(baseAmountCents ?? 0),
    })

    // Idempotency: if a booking already exists for this payment intent, return it (website only)
    if (stripePaymentIntentId) {
      const supabase = createAdminClient()
      const { data: existing, error: existingErr } = await supabase
        .from('bookings')
        .select('id, booking_uuid')
        .eq('stripe_payment_intent_id', stripePaymentIntentId)
        .maybeSingle()
      if (existingErr) {
        console.error('[book] idempotency SELECT error:', existingErr)
      }
      if (existing) {
        return apiOk({ booking: existing, deduplicated: true })
      }
      // The public website no longer reaches /book — the Stripe webhook is the sole
      // finalizer there. The remaining /book callers are admin-initiated (internal,
      // partner-invoice, stripe_recovery) and single-path, so no claim mutex is
      // needed. The bookings UNIQUE(stripe_payment_intent_id) constraint + the
      // findRaceWinner re-check + the 23505-cancel branch below remain the backstop
      // against any rare race (e.g. an admin card payment that the webhook also sees).
    }

    // ── Payment gate for public (website) bookings ───────────────────────────
    // SECURITY (2026-07): this route re-exports to the PUBLIC /api/booking-flow/book,
    // which takes no admin auth for `website` source. Internal sources are already
    // gated above (admin session or a validated partner code). A `website` booking
    // must therefore PROVE payment before we create a real FareHarbor reservation —
    // otherwise anyone could POST a booking and consume boat capacity for free.
    // Paid website checkouts are normally finalized by the Stripe webhook; if a
    // request reaches /book directly it must carry a settled PaymentIntent whose
    // server-set metadata matches the booking it's asking us to create.
    if (!isInternal) {
      if (!stripePaymentIntentId) {
        return apiError('Payment required for this booking.', 402)
      }
      let pi
      try {
        pi = await getStripe().paymentIntents.retrieve(String(stripePaymentIntentId))
      } catch {
        return apiError('Could not verify payment.', 402)
      }
      if (pi.status !== 'succeeded') {
        return apiError('Payment has not been completed.', 402)
      }
      // Bind the booking to what was actually paid for. PI metadata is set
      // server-side at intent creation (create-intent.ts) and cannot be forged by
      // the client, so this blocks paying for a cheap slot then booking another.
      const md = pi.metadata ?? {}
      const paymentMatchesBooking =
        String(md.avail_pk ?? '') === String(availPk) &&
        String(md.customer_type_rate_pk ?? '') === String(customerTypeRatePk) &&
        String(md.guest_count ?? '') === String(guestCount)
      if (!paymentMatchesBooking) {
        return apiError('Booking details do not match the payment.', 409)
      }
    }

    const fh = getFareHarborClient()

    // Private boats: book the boat once (quantity=1) — the customer type rate IS the duration.
    // Shared boats: each guest is a separate customer entry.
    // When customerTypeRates is provided (e.g. adult + child mix), build one entry per
    // ticket using the correct rate pk — fixing child tickets being priced as adults.
    const isPrivate = category === 'private'
    const customerCount = isPrivate ? 1 : Number(guestCount)

    const multiRates = !isPrivate && Array.isArray(customerTypeRates) && customerTypeRates.length > 0
    const customers = multiRates
      ? (customerTypeRates as Array<{ pk: number; count: number }>).flatMap(({ pk, count }) =>
          Array.from({ length: count }, () => ({ customer_type_rate: Number(pk) }))
        )
      : Array.from({ length: customerCount }, () => ({
          customer_type_rate: Number(customerTypeRatePk),
        }))

    const bookingData = {
      contact: {
        name: String(contact.name),
        phone: String(contact.phone),
        email: String(contact.email),
      },
      customers,
      note: note ? String(note) : undefined,
    }

    // Failure-alert context, reused for any FH error path below
    const failureCtx = {
      stripePaymentIntentId: stripePaymentIntentId ?? null,
      amountCents: Number(amountCents ?? 0) || null,
      customer: {
        name: contact?.name,
        email: contact?.email,
        phone: contact?.phone,
      },
      cruise: {
        listingTitle: String(listingTitle ?? ''),
        date: String(date ?? ''),
        startAt: startAt ?? null,
        guestCount: Number(guestCount),
        category: String(category ?? ''),
      },
      fareharbor: {
        availPk: Number(availPk),
        customerTypeRatePk: Number(customerTypeRatePk),
      },
    } as const

    // ── FareHarbor validate + create (skipped when overrideMinParty is set) ──
    // overrideMinParty is only honoured for stripe_recovery bookings where the
    // customer already paid but FH rejects due to minimum party size. The admin
    // records the revenue locally and creates the FH booking manually.
    let booking: FHBookingResponse | undefined = undefined

    if (overrideMinParty && isStripeRecovery) {
      // Intentionally skip FareHarbor — fhBookingUuid will be null in Supabase.
      console.info('[book] overrideMinParty: skipping FareHarbor validate+create for stripe_recovery')
    } else {
      // Step 1: Validate — FareHarbor always returns 200; is_bookable tells us if it's valid
      const validation = await fh.validateBooking(Number(availPk), bookingData)
      if (!validation.is_bookable) {
        // Re-check before alerting: the webhook may have created this booking while /book
        // was claiming + validating. FH then rejects /book's validate because the slot
        // is already consumed — a self-collision, not a real failure. The winning
        // path may not have COMMITTED its bookings row yet, so poll briefly (a few
        // short retries) rather than a single SELECT before concluding it's a real failure.
        if (stripePaymentIntentId) {
          const raceWinner = await findRaceWinner(String(stripePaymentIntentId))
          if (raceWinner) {
            console.log('[book] FH validate failed but booking exists (webhook won race) — deduplicating', stripePaymentIntentId)
            return apiOk({ booking: raceWinner, deduplicated: true })
          }
        }
        // Fire-and-forget alert. Especially critical when stripePaymentIntentId is set
        // (customer already charged) — but also useful for ops visibility on internal failures.
        await notifyBookingFailure({
          ...failureCtx,
          stage: 'fareharbor_validate',
          reason: validation.error ?? 'Slot not bookable',
        }).catch(err => console.error('[book] notifyBookingFailure (validate) failed:', err))
        return apiError(validation.error ?? 'Booking is not available', 422)
      }

      // Step 2: Create FareHarbor booking
      try {
        booking = await fh.createBooking(Number(availPk), bookingData)
      } catch (fhErr) {
        const msg = fhErr instanceof Error ? fhErr.message : String(fhErr)
        await notifyBookingFailure({
          ...failureCtx,
          stage: 'fareharbor_create',
          reason: msg,
        }).catch(err => console.error('[book] notifyBookingFailure (create) failed:', err))
        throw fhErr // Re-throw so the outer catch returns a proper 500 to the client
      }
    }

    // Step 3a: Save to Supabase — BLOCKING.
    // This is the money-path: customer paid, FareHarbor booked, we MUST record it.
    // If it fails, we alert loudly but still return success (the cruise is reserved).
    // Google Click ID (oc_gclid cookie) — stored on the booking for admin
    // visibility into which bookings came from a Google ad. Card-payment
    // bookings are created here; the webhook handles the iDEAL/async path.
    const gclid = request.cookies.get('oc_gclid')?.value ?? null

    // Session attribution: the browsing session is captured on the PaymentIntent
    // at intent-creation (metadata.session_id) — the same source the Stripe webhook
    // trusts. body.sessionId is read client-side AFTER the payment redirect and
    // points at a fresh "/confirmation" session, so it must NOT win. Retrieve the
    // PI and prefer its session; never block a paid booking on this lookup.
    let piSessionId: string | null = null
    // The VAT invoice must reflect what was actually CHARGED, not numbers the
    // browser posted. The PI metadata carries the server-computed base + discount
    // (set in create-intent); prefer those so a tampered request body can never
    // mint an invoice with an arbitrary amount. Falls back to body values only
    // when the PI lookup fails.
    let invoiceBaseCents: number = Number(baseAmountCents ?? 0)
    let invoiceDiscountCents: number = Number(body.discountAmountCents ?? 0)
    if (!isInternal && stripePaymentIntentId) {
      try {
        const pi = await getStripe().paymentIntents.retrieve(String(stripePaymentIntentId))
        piSessionId = pi.metadata?.session_id ?? null
        const serverBase = Number(pi.metadata?.server_base_amount_cents ?? 0)
        if (serverBase > 0) invoiceBaseCents = serverBase
        if (pi.metadata?.discount_amount_cents != null) {
          invoiceDiscountCents = Number(pi.metadata.discount_amount_cents)
        }
      } catch (err) {
        console.error('[book] could not read metadata from PaymentIntent:', err)
      }
    }
    const sessionId = pickBookingSessionId(piSessionId, body.sessionId as string | null)

    let stripeInvoiceResult: StripeInvoiceResult | null = null
    let stripeCustomerId: string | null = null
    let businessProfileId: string | null = null

    if (isStripeInvoice && body.businessDetails) {
      const bd = body.businessDetails
      const stripeCustomer = await getOrCreateStripeCustomer({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        companyName: bd.companyName,
        kvkNumber: bd.kvkNumber,
        vatNumber: bd.vatNumber,
        address: {
          line1: bd.addressLine1,
          postal_code: bd.postalCode,
          city: bd.city,
          country: bd.countryCode || 'NL',
        },
      })
      stripeCustomerId = stripeCustomer.id

      try {
        const invoiceRes = await createAndSendStripeInvoice({
          customerId: stripeCustomer.id,
          bookingId: booking?.uuid ?? `inv_${Date.now()}`,
          fhBookingUuid: booking?.uuid,
          listingTitle: String(listingTitle ?? ''),
          bookingDate: String(date ?? ''),
          startTime: startAt ?? null,
          guestCount: Number(guestCount),
          baseAmountCents: Number(baseAmountCents ?? 0),
          extrasSelected: (extrasSelected ?? []) as Array<{ name: string; amount_cents: number }>,
          cityTaxCents: Number(guestCount) * CITY_TAX_CENTS_PER_GUEST,
          discountAmountCents: Number(body.discountAmountCents ?? 0),
          category: String(category ?? 'private'),
          daysAfterTour: 14,
        })
        stripeInvoiceResult = invoiceRes
      } catch (invoiceErr) {
        if (booking?.uuid) {
          try {
            await fh.cancelBooking(booking.uuid)
          } catch (cancelErr) {
            console.error('[book] Failed to cancel FH booking after invoice failure:', cancelErr)
          }
        }
        throw invoiceErr
      }

      // Upsert business profile for autocomplete
      try {
        const supabase = createAdminClient()
        const { data: profile } = await supabase
          .from('business_profiles')
          .upsert({
            company_name: bd.companyName.trim(),
            kvk_number: bd.kvkNumber?.trim() || null,
            vat_number: bd.vatNumber?.trim() || null,
            contact_name: contact.name,
            contact_email: contact.email,
            contact_phone: contact.phone,
            address_line1: bd.addressLine1.trim(),
            postal_code: bd.postalCode.trim(),
            city: bd.city.trim(),
            country_code: bd.countryCode || 'NL',
            stripe_customer_id: stripeCustomer.id,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'company_name' })
          .select('id')
          .maybeSingle()
        if (profile?.id) businessProfileId = profile.id
      } catch (err) {
        console.warn('[book] business_profiles upsert failed:', err)
      }
    }

    const bookingPayload = buildBookingPayload(
      body,
      { uuid: booking?.uuid },
      { isInternal, isStripeRecovery },
      {
        campaignId: cookieCampaignId,
        partnerId,
        commissionAmountCents,
        gclid,
        sessionId,
      },
      isStripeInvoice && body.businessDetails ? {
        stripeInvoiceId: stripeInvoiceResult?.invoiceId ?? null,
        stripeInvoiceUrl: stripeInvoiceResult?.hostedInvoiceUrl ?? null,
        stripeCustomerId,
        businessProfileId,
        companyName: body.businessDetails.companyName,
        companyKvk: body.businessDetails.kvkNumber || null,
        companyVat: body.businessDetails.vatNumber || null,
        companyAddress: `${body.businessDetails.addressLine1}, ${body.businessDetails.postalCode} ${body.businessDetails.city}`,
        invoiceDueDate: stripeInvoiceResult?.dueDate ?? null,
      } : undefined,
    )

    const saveResult = await saveToSupabase(bookingPayload)
    if (!saveResult.ok) {
      if (saveResult.code === '23505') {
        // A concurrent path (webhook/recover) already saved this payment's booking.
        // Ours is the duplicate — cancel our FareHarbor booking so the boat isn't
        // blocked twice (parity with the webhook + recover paths). This is a
        // cleanly-handled race, NOT a failure: no CRITICAL alert. Claim released in finally.
        console.warn('[book] 23505 — concurrent path won; cancelling our FH booking', booking?.uuid)
        if (booking?.uuid) {
          try {
            await fh.cancelBooking(booking.uuid)
          } catch (err) {
            console.error('[book] failed to cancel duplicate FH booking', booking.uuid, err)
          }
        }
        if (stripeInvoiceResult?.invoiceId) {
          try {
            await voidStripeInvoice(stripeInvoiceResult.invoiceId)
          } catch (err) {
            console.error('[book] failed to void duplicate Stripe invoice', stripeInvoiceResult.invoiceId, err)
          }
        }
        return apiOk({ deduplicated: true })
      }
      // Genuine DB failure: the FareHarbor booking EXISTS but our record didn't
      // save. Alert ops to REPAIR the row (the alert wording reflects this).
      await alertBookingSaveFailure(bookingPayload, saveResult.error)
      // Still return success to customer — they got what they paid for.
    } else {
      await notifyBookingsChanged()
      await emitOpsEvent({
        eventType: 'booking_confirmed',
        actorType: 'system',
        source: 'admin/booking-flow/book',
        payload: { category: category ?? null, guest_count: Number(guestCount), booking_date: date ?? null },
      })
      // Off the response path: does this new booking reveal a gap-closing
      // guest-move opportunity today? (Beer 2026-07-04 — every new booking
      // checks its own date immediately, not just the nightly scan.)
      if (date) {
        after(() =>
          draftGuestMoveForNewBooking(String(date)).catch(err =>
            console.error('[book] guest-move check failed:', err),
          ),
        )
        // Keep the shift roster in sync the moment a booking becomes real, and
        // try to auto-assign its captain — covers admin-created bookings,
        // complimentary/partner-invoice bookings, and Ghost's OTA-approved
        // `book` action (which reuses this exact route, see
        // proposals/[id]/route.ts). Idempotent: safe even if this date
        // already synced/scheduled today.
        after(() =>
          syncAndScheduleShifts(createAdminClient(), String(date)).catch(err =>
            console.error('[book] shift sync failed:', err),
          ),
        )
      }
    }

    // Resolve the selected customer type(s) for the Slack alert — e.g. "Diana - 2 Hours",
    // or "2× Adult · 1× Child" for a mixed shared booking. Best-effort; piggybacks on
    // the availability detail already cached by the booking save.
    const customerTypesLabel = await describeCustomerTypes(Number(availPk), {
      customerTypeRatePk: customerTypeRatePk ? Number(customerTypeRatePk) : null,
      customerTypeRates: Array.isArray(customerTypeRates)
        ? (customerTypeRates as Array<{ pk: number; count: number }>)
        : null,
    })

    // Catering already inside the 7-day auto-send window at creation time (e.g. a
    // last-minute booking) gets its supplier email sent instantly here, instead of
    // waiting for the daily cron. Bookings further out stay queued — the cron picks
    // them up the day they cross the 7-day mark. Requires the row to have actually
    // saved (saveResult.ok) since the send looks the booking up by its id.
    const savedBookingId = saveResult.ok ? saveResult.id : null
    const shouldAutoSendCateringNow =
      savedBookingId !== null &&
      hasFood((extrasSelected ?? []) as never) &&
      isWithinCateringAutoSendWindow(String(date ?? ''))

    // Step 3b: Non-critical notifications — run concurrently, fail quietly
    await Promise.allSettled([
      notifyCateringOrder({
        cruiseName: String(listingTitle ?? ''),
        dateStr: String(date ?? ''),
        startTimeStr: startAt ?? null,
        guestCount: Number(guestCount),
        extrasSelected: (extrasSelected ?? []) as never,
        listingId: listingId ?? null,
      }),
      sendSlackNotification({
        listingTitle: String(listingTitle ?? ''),
        date: String(date ?? ''),
        startAt: startAt ?? null,
        endAt: endAt ?? null,
        guestCount: Number(guestCount),
        category: String(category ?? ''),
        customerTypesLabel,
        contact,
        amountCents: Number(baseAmountCents ?? 0) + Number(extrasAmountCents ?? 0),
        fhBookingUuid: booking?.uuid,
        stripePaymentIntentId: isInternal ? '' : String(stripePaymentIntentId ?? ''),
        extrasSelected: extrasSelected ?? [],
        totalVatAmountCents: Number(totalVatAmountCents ?? 0),
        bookingSource: bookingSource as BookingSource,
        depositAmountCents: isInternal ? Number(depositAmountCents ?? 0) : null,
        partnerInvoice: partnerInvoiceContext
          ? {
              partnerName: partnerInvoiceContext.partnerName,
              baseAmountCents: Number(baseAmountCents ?? 0),
              // Same helper as the DB write above so the Slack figure can't drift if rounding changes.
              commissionAmountCents: commissionForCampaign(
                { percentage_value: partnerInvoiceContext.commissionPercent, investment_type: 'percentage' },
                Number(baseAmountCents ?? 0),
              ) ?? 0,
              commissionPercent: partnerInvoiceContext.commissionPercent,
            }
          : null,
        invoiceLater: invoiceLaterContext
          ? {
              partnerName: invoiceLaterContext.partnerName,
              invoiceAmountCents: invoiceLaterContext.invoiceAmountCents,
              commissionAmountCents: invoiceLaterContext.commissionAmountCents,
            }
          : null,
      }),
      sendConfirmationEmail({
        contact,
        listingTitle: String(listingTitle ?? ''),
        departureLocation: String(departureLocation ?? 'Brouwersgracht 29, Amsterdam'),
        date: String(date ?? ''),
        startAt: startAt ?? null,
        endAt: endAt ?? null,
        guestCount: Number(guestCount),
        amountCents: Number(amountCents ?? 0),
        extrasSelected: (extrasSelected ?? []) as Array<{ name: string; amount_cents: number }>,
        fhBookingUuid: booking?.uuid,
        category: category ? String(category) : null,
        fareharborCustomerTypeRatePk: customerTypeRatePk ? Number(customerTypeRatePk) : null,
        stripePaymentIntentId: isInternal ? null : (stripePaymentIntentId ?? null),
        baseAmountCents: invoiceBaseCents || null,
        discountAmountCents: invoiceDiscountCents,
      }),
      ...(shouldAutoSendCateringNow && savedBookingId ? [sendCateringOrderEmailForBooking(savedBookingId)] : []),
    ])

    // When FareHarbor was intentionally skipped (minimum party override), return a
    // clear local-only marker so the UI can show a tailored confirmation message.
    if (overrideMinParty && isStripeRecovery && !booking) {
      return apiOk({
        booking: {
          localOnly: true,
          message: 'Revenue recorded locally. No FareHarbor booking created — add it manually in the FH admin dashboard.',
        },
      })
    }

    if (stripeInvoiceResult && body.businessDetails) {
      const bd = body.businessDetails
      const totalCents = Number(baseAmountCents ?? 0) + Number(extrasAmountCents ?? 0) + (Number(guestCount) * CITY_TAX_CENTS_PER_GUEST) - Number(body.discountAmountCents ?? 0)
      postSlackOps([
        `📄 *Stripe Invoice Created & Sent!*`,
        `🏢 *${bd.companyName}* · €${(totalCents / 100).toFixed(2)}`,
        `👤 ${contact.name} (${contact.email})`,
        `📅 Tour: ${date}  ·  Due: ${stripeInvoiceResult.dueDate} (14 days after tour)`,
        `🎫 FH: ${booking?.uuid ?? '—'}  ·  Invoice: \`${stripeInvoiceResult.invoiceNumber || stripeInvoiceResult.invoiceId}\``,
        stripeInvoiceResult.hostedInvoiceUrl ? `🔗 <${stripeInvoiceResult.hostedInvoiceUrl}|View Hosted Invoice>` : '',
      ].filter(Boolean).join('\n')).catch(err => console.error('[book] Slack invoice notification error:', err))
    }

    return apiOk({
      booking: booking ? {
        ...booking,
        stripe_invoice_id: stripeInvoiceResult?.invoiceId,
        stripe_invoice_url: stripeInvoiceResult?.hostedInvoiceUrl,
      } : booking,
      invoice: stripeInvoiceResult,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}

// ── Side effect helpers ────────────────────────────────────────────────────

interface BookingPayload {
  fhBookingUuid?: string
  availPk: number
  customerTypeRatePk: number
  guestCount: number
  category: string
  contact: { name: string; email: string; phone: string }
  note?: string
  listingId: string | null
  listingTitle: string
  date: string
  startAt: string | null
  endAt: string | null
  amountCents: number
  baseAmountCents: number
  extrasSelected: object[]
  extrasAmountCents: number
  extrasVatAmountCents: number
  baseVatAmountCents: number
  totalVatAmountCents: number
  stripePaymentIntentId: string | null
  bookingSource: BookingSource
  depositAmountCents: number | null
  sessionId: string | null
  // Partner commission attribution (from oc_attr cookie, promo code, or partner-invoice)
  cookieCampaignId: string | null
  partnerId: string | null
  commissionAmountCents: number | null
  // Google Click ID (oc_gclid cookie) — for admin visibility into Google-ad bookings
  gclid: string | null
  promoCodeId: string | null
  discountAmountCents: number
  // Stripe Invoicing (Op Factuur)
  stripeInvoiceId?: string | null
  stripeInvoiceUrl?: string | null
  stripeCustomerId?: string | null
  businessProfileId?: string | null
  companyName?: string | null
  companyKvk?: string | null
  companyVat?: string | null
  companyAddress?: string | null
  invoiceDueDate?: string | null
}

/**
 * Look for a bookings row already created for this PI by a racing path (webhook
 * or /recover). Polls a few times with a short delay because the winner may have
 * created the FareHarbor booking (consuming the slot, so our validate fails) but
 * not yet COMMITTED its Supabase row — a single SELECT would miss it and we'd
 * fire a false "paid but no booking" alert. Returns the row, or null if none
 * appears within the window.
 */
async function findRaceWinner(
  stripePaymentIntentId: string,
): Promise<{ id: string; booking_uuid: string | null } | null> {
  const supabase = createAdminClient()
  const ATTEMPTS = 3
  const DELAY_MS = 600
  for (let i = 0; i < ATTEMPTS; i++) {
    const { data } = await supabase
      .from('bookings')
      .select('id, booking_uuid')
      .eq('stripe_payment_intent_id', stripePaymentIntentId)
      .maybeSingle()
    if (data) return data as { id: string; booking_uuid: string | null }
    if (i < ATTEMPTS - 1) await new Promise(r => setTimeout(r, DELAY_MS))
  }
  return null
}

/**
 * Build the canonical `BookingPayload` from the raw request body + derived fields.
 *
 * Centralises all the `Number(... ?? 0)` coercions, the VAT fallback math, and the
 * source-dependent rules for `stripePaymentIntentId` + `depositAmountCents`. The
 * downstream `saveToSupabase` reads this shape directly into the bookings table.
 *
 * `attribution.campaignId` writes to the field named `cookieCampaignId` for legacy
 * reasons — that field can now be set by cookie, promo code, OR partner-invoice.
 * Renaming the field would couple to DB column meaning; the name stays.
 *
 * Pure (no I/O). Easy to unit-test if regressions show up here.
 */
function buildBookingPayload(
  body: Record<string, unknown>,
  fhBooking: { uuid?: string } | null,
  flags: { isInternal: boolean; isStripeRecovery: boolean },
  attribution: {
    campaignId: string | null
    partnerId: string | null
    commissionAmountCents: number | null
    gclid: string | null
    sessionId: string | null
  },
  invoiceMeta?: {
    stripeInvoiceId?: string | null
    stripeInvoiceUrl?: string | null
    stripeCustomerId?: string | null
    businessProfileId?: string | null
    companyName?: string | null
    companyKvk?: string | null
    companyVat?: string | null
    companyAddress?: string | null
    invoiceDueDate?: string | null
  },
): BookingPayload {
  const baseAmt = Number(body.baseAmountCents ?? 0)
  const extrasAmt = Number(body.extrasAmountCents ?? 0)
  const { isInternal, isStripeRecovery } = flags

  return {
    fhBookingUuid: fhBooking?.uuid,
    availPk: Number(body.availPk),
    customerTypeRatePk: Number(body.customerTypeRatePk),
    guestCount: Number(body.guestCount),
    category: String(body.category ?? 'private'),
    contact: body.contact as BookingPayload['contact'],
    note: body.note as string | undefined,
    listingId: (body.listingId as string | null) ?? null,
    listingTitle: String(body.listingTitle ?? ''),
    date: String(body.date ?? ''),
    startAt: (body.startAt as string | null) ?? null,
    endAt: (body.endAt as string | null) ?? null,
    amountCents: Number(body.amountCents ?? 0),
    baseAmountCents: baseAmt,
    extrasSelected: (body.extrasSelected as object[] | undefined) ?? [],
    extrasAmountCents: extrasAmt,
    // VAT fields: server-compute when missing/zero. The browser-side checkout
    // (CheckoutFlow.tsx) doesn't always send these; the admin flow does. To
    // avoid silently recording €0 VAT on website bookings, fall back to a
    // 9%-of-base + 21%-default-on-extras calculation. City tax is 0% VAT
    // (municipal levy, not included in base_amount_cents).
    extrasVatAmountCents: Number(body.extrasVatAmountCents)
      || extractVat(extrasAmt, DEFAULT_EXTRAS_VAT_RATE_PERCENT),
    baseVatAmountCents: Number(body.baseVatAmountCents)
      || extractVat(baseAmt, BASE_VAT_RATE_PERCENT),
    totalVatAmountCents: Number(body.totalVatAmountCents)
      || (extractVat(baseAmt, BASE_VAT_RATE_PERCENT)
          + extractVat(extrasAmt, DEFAULT_EXTRAS_VAT_RATE_PERCENT)),
    // For stripe_recovery: persist the admin-provided PI ID (cross-reference to original payment).
    // For other internal sources: null. For website: the just-charged PI.
    stripePaymentIntentId: isStripeRecovery
      ? (body.recoveryStripePaymentIntentId ? String(body.recoveryStripePaymentIntentId) : null)
      : isInternal ? null : String(body.stripePaymentIntentId ?? ''),
    bookingSource: (body.bookingSource && body.bookingSource !== 'undefined' ? String(body.bookingSource) : 'website') as BookingSource,
    depositAmountCents: (isInternal && !isStripeRecovery && body.bookingSource !== 'stripe_invoice') ? Number(body.depositAmountCents ?? 0) : null,
    sessionId: attribution.sessionId,
    cookieCampaignId: attribution.campaignId,
    partnerId: attribution.partnerId,
    commissionAmountCents: attribution.commissionAmountCents,
    gclid: attribution.gclid,
    promoCodeId: (body.promoCodeId as string | null) ?? null,
    discountAmountCents: Number(body.discountAmountCents ?? 0),
    stripeInvoiceId: invoiceMeta?.stripeInvoiceId ?? null,
    stripeInvoiceUrl: invoiceMeta?.stripeInvoiceUrl ?? null,
    stripeCustomerId: invoiceMeta?.stripeCustomerId ?? null,
    businessProfileId: invoiceMeta?.businessProfileId ?? null,
    companyName: invoiceMeta?.companyName ?? null,
    companyKvk: invoiceMeta?.companyKvk ?? null,
    companyVat: invoiceMeta?.companyVat ?? null,
    companyAddress: invoiceMeta?.companyAddress ?? null,
    invoiceDueDate: invoiceMeta?.invoiceDueDate ?? null,
  }
}

async function resolveCampaignId(supabase: ReturnType<typeof createAdminClient>, bookingSource: string): Promise<string | null> {
  if (!PLATFORM_SOURCES.includes(bookingSource as typeof PLATFORM_SOURCES[number])) return null
  const { data } = await supabase
    .from('campaigns')
    .select('id')
    .eq('slug', bookingSource)
    .single()
  return data?.id ?? null
}

/** The resolved partner-invoice context — null when the booking isn't partner-invoice. */
interface PartnerInvoiceContext {
  partnerId: string
  partnerName: string
  campaignId: string
  commissionPercent: number
}

type PartnerInvoiceResolution =
  | { ok: true; context: PartnerInvoiceContext | null }
  | { ok: false; error: string; status: number }

/**
 * Resolve the partner-invoice booking context — the listing's required partner,
 * the campaign linking them, and the commission % to charge.
 *
 * For non-partner-invoice bookings, immediately returns `{ ok: true, context: null }`
 * so the caller can use the result unconditionally.
 *
 * Validation paths (in order):
 *   1. `listingId` must be provided
 *   2. Listing must exist + have `payment_mode === 'partner_invoice'` + a required_partner_id
 *   3. If no `promoCodeId` is passed (legacy path), validate the `partnerCode` against partner_codes
 *   4. An active campaign linking this listing + partner must exist
 *   5. That campaign must use a percentage commission with a positive value
 *
 * Each failed validation returns `{ ok: false, error, status }` with a user-facing message.
 *
 * Side effects: 4 reads to Supabase (listing, optional partner_codes, campaign, partner).
 * No writes.
 */
async function resolvePartnerInvoiceContext(params: {
  isPartnerInvoice: boolean
  listingId: string | null
  promoCodeId: string | null
  partnerCode: string | null
}): Promise<PartnerInvoiceResolution> {
  if (!params.isPartnerInvoice) return { ok: true, context: null }

  const { listingId, promoCodeId, partnerCode } = params
  if (!listingId) {
    return { ok: false, error: 'listingId is required for partner-invoice bookings', status: 400 }
  }

  const supabase = createAdminClient()
  const { data: listing } = await supabase
    .from('cruise_listings')
    .select('id, payment_mode, required_partner_id')
    .eq('id', listingId)
    .single()

  if (!listing) return { ok: false, error: 'Listing not found', status: 404 }
  if (listing.payment_mode !== 'partner_invoice' || !listing.required_partner_id) {
    return { ok: false, error: 'This listing does not accept partner-invoice bookings', status: 400 }
  }

  // New path: promo code already validated by client via /api/promo/validate.
  // Legacy path: validate against partner_codes table.
  if (!promoCodeId) {
    const normalizedCode = normalizePartnerCode(String(partnerCode ?? ''))
    const { data: codeRow } = await supabase
      .from('partner_codes')
      .select('id, partner_id, code, is_active, expires_at, revoked_at')
      .eq('code', normalizedCode)
      .maybeSingle()

    const result = validatePartnerCode(normalizedCode, listing.required_partner_id, codeRow)
    if (!result.ok) return { ok: false, error: reasonMessage(result.reason), status: 400 }
  }

  // Find the campaign linking this listing + partner to get the commission %.
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, percentage_value, investment_type, partner_id')
    .eq('listing_id', listingId)
    .eq('partner_id', listing.required_partner_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!campaign) {
    return {
      ok: false,
      error: 'No active campaign found for this partner + listing. An admin must create a campaign first.',
      status: 422,
    }
  }
  if (campaign.investment_type !== 'percentage' || !campaign.percentage_value) {
    return {
      ok: false,
      error: 'Partner-invoice campaigns must use a percentage commission. Fix the campaign config.',
      status: 422,
    }
  }

  const { data: partner } = await supabase
    .from('partners')
    .select('id, name')
    .eq('id', listing.required_partner_id)
    .single()

  return {
    ok: true,
    context: {
      partnerId: listing.required_partner_id,
      partnerName: partner?.name ?? 'Partner',
      campaignId: campaign.id,
      commissionPercent: Number(campaign.percentage_value),
    },
  }
}

/** The resolved "invoice later" context — null when the booking isn't invoice_later. */
interface InvoiceLaterContext {
  partnerId: string
  partnerName: string
  commissionAmountCents: number
  invoiceAmountCents: number
}

type InvoiceLaterResolution =
  | { ok: true; context: InvoiceLaterContext | null }
  | { ok: false; error: string; status: number }

/**
 * Resolve the "invoice later" context — an admin picking an existing partner
 * directly (no code, unlike the Webikeamsterdam QR flow). No campaign lookup
 * happens here: the admin already saw a suggested amount from
 * /api/admin/booking-flow/invoice-suggestion (or typed their own) before
 * submitting, so `invoiceAmountCents` is authoritative here, not re-derived.
 *
 * For non-invoice_later bookings, immediately returns `{ ok: true, context: null }`.
 */
async function resolveInvoiceLaterContext(params: {
  isInvoiceLater: boolean
  partnerId: string | null
  baseAmountCents: number
  invoiceAmountCents: number | null
}): Promise<InvoiceLaterResolution> {
  if (!params.isInvoiceLater) return { ok: true, context: null }
  if (!params.partnerId) {
    return { ok: false, error: 'partnerId is required for invoice_later bookings', status: 400 }
  }

  const supabase = createAdminClient()
  const { data: partner } = await supabase
    .from('partners')
    .select('id, name')
    .eq('id', params.partnerId)
    .maybeSingle()
  if (!partner) return { ok: false, error: 'Partner not found', status: 404 }

  const invoiceAmountCents = params.invoiceAmountCents ?? params.baseAmountCents
  return {
    ok: true,
    context: {
      partnerId: params.partnerId,
      partnerName: partner.name ?? 'Partner',
      commissionAmountCents: commissionFromInvoiceAmount(params.baseAmountCents, invoiceAmountCents),
      invoiceAmountCents,
    },
  }
}

/**
 * Resolve campaign attribution + commission for this booking.
 *
 * Precedence (last-wins, matching pre-refactor behavior):
 *   1. Cookie (`oc_attr` JSON, set by /api/t/[slug] or /api/track/visit)
 *   2. Promo code with campaign_id (explicit code-scoped attribution)
 *   3. Partner-invoice context (always wins when present)
 *
 * All errors during cookie/promo lookup are non-fatal — booking proceeds with
 * whatever attribution resolved. The partner-invoice override never fails
 * because the context was already validated before this is called.
 *
 * Returns `{ campaignId, partnerId, commissionAmountCents }` where each is
 * either set by one of the sources or remains null.
 *
 * Side effects: up to 3 reads to Supabase (cookie campaign + promo row + promo campaign).
 * No writes.
 */
export async function resolveAttribution(params: {
  attrCookie: string | null
  promoCodeId: string | null
  partnerInvoiceContext: PartnerInvoiceContext | null
  invoiceLaterContext: InvoiceLaterContext | null
  baseAmountCents: number
}): Promise<{ campaignId: string | null; partnerId: string | null; commissionAmountCents: number | null }> {
  let campaignId: string | null = null
  let partnerId: string | null = null
  let commissionAmountCents: number | null = null

  // Layer 1: cookie attribution. partnerId is resolved fresh from the campaign
  // row (via resolveCampaignCommission), not trusted from the cookie's own
  // snapshot — the cookie can outlive a partner reassignment on the campaign,
  // and the FK is continuously enforced by Postgres, so the row is always
  // current. This matches Layer 2 below and the Stripe webhook's own lookup
  // (src/lib/booking/campaign-commission.ts) — previously this layer alone
  // trusted the cookie's partner_id, a real drift between the two call sites.
  try {
    if (params.attrCookie) {
      const attr = parseAttribution(params.attrCookie)
      if (attr?.campaign_id) {
        const supabase = createAdminClient()
        const resolved = await resolveCampaignCommission(supabase, attr.campaign_id, params.baseAmountCents)
        if (resolved) {
          campaignId = resolved.campaignId
          partnerId = resolved.partnerId
          commissionAmountCents = resolved.commissionAmountCents
        }
      }
    }
  } catch {
    // Attribution errors are non-fatal — booking still proceeds
  }

  // Layer 2: promo code with campaign_id overrides cookie
  if (params.promoCodeId) {
    try {
      const supabase = createAdminClient()
      const { data: promoRow } = await supabase
        .from('promo_codes')
        .select('campaign_id')
        .eq('id', params.promoCodeId)
        .maybeSingle()
      if (promoRow?.campaign_id) {
        const resolved = await resolveCampaignCommission(supabase, promoRow.campaign_id, params.baseAmountCents)
        if (resolved) {
          campaignId = resolved.campaignId
          partnerId = resolved.partnerId
          commissionAmountCents = resolved.commissionAmountCents
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Layer 3: partner-invoice context (Webikeamsterdam QR checkout)
  if (params.partnerInvoiceContext) {
    campaignId = params.partnerInvoiceContext.campaignId
    partnerId = params.partnerInvoiceContext.partnerId
    // Partner-invoice campaigns are always percentage-based (validated upstream).
    commissionAmountCents = commissionForCampaign(
      {
        percentage_value: params.partnerInvoiceContext.commissionPercent,
        investment_type: 'percentage',
      },
      params.baseAmountCents,
    )
  }

  // Layer 4: "Invoice later" — admin picked the partner directly (highest
  // priority; mutually exclusive with layer 3, since a booking is either the
  // public QR flow or this admin flow, never both). No campaign lookup here —
  // the admin already confirmed the final commission via the invoice-suggestion
  // endpoint (or typed their own), so this is authoritative, not re-derived.
  if (params.invoiceLaterContext) {
    partnerId = params.invoiceLaterContext.partnerId
    commissionAmountCents = params.invoiceLaterContext.commissionAmountCents
  }

  return { campaignId, partnerId, commissionAmountCents }
}

/**
 * Save booking to Supabase. Returns success flag + error details.
 * Caller is responsible for alerting on failure — this is the money-path,
 * we MUST know when it breaks.
 */
async function saveToSupabase(p: BookingPayload): Promise<{ ok: true; id: string } | { ok: false; error: string; code?: string }> {
  try {
    const supabase = createAdminClient()
    const isInternal = p.bookingSource !== 'website'
    const isStripeRecovery = p.bookingSource === 'stripe_recovery'
    // Campaign attribution: cookie-based partner tracking takes priority,
    // then fall back to auto-attribution for platform booking sources.
    const campaignId = p.cookieCampaignId ?? await resolveCampaignId(supabase, p.bookingSource)
    // booking_id: use the provided Stripe PI for website OR recovery (when given),
    // otherwise FH UUID for internal, with a recovery_ fallback when both are missing.
    const bookingId = isStripeRecovery
      ? (p.stripePaymentIntentId || p.fhBookingUuid || `recovery_${Date.now()}`)
      : isInternal
        ? (p.fhBookingUuid ?? `internal_${Date.now()}`)
        : (p.stripePaymentIntentId ?? '')
    // Snapshot the customer-type label (best-effort; null never blocks the booking).
    const customerTypeName = await resolveCustomerTypeName(p.availPk, p.customerTypeRatePk)
    const { data: inserted, error } = await supabase.from('bookings').insert({
      booking_id: bookingId,
      booking_uuid: p.fhBookingUuid ?? null,
      fareharbor_availability_pk: p.availPk,
      fareharbor_customer_type_rate_pk: p.customerTypeRatePk,
      customer_type_name: customerTypeName,
      stripe_payment_intent_id: p.stripePaymentIntentId,
      // Stripe recovery: use the admin-entered amount (real revenue). Other internal: 0.
      // Website / stripe_invoice: compute from base + extras + city tax − discount.
      stripe_amount: isStripeRecovery
        ? p.amountCents
        : (isInternal && p.bookingSource !== 'stripe_invoice')
          ? 0
          : p.baseAmountCents + p.extrasAmountCents + (p.guestCount * CITY_TAX_CENTS_PER_GUEST) - p.discountAmountCents,
      base_amount_cents: p.baseAmountCents,
      base_vat_rate: BASE_VAT_RATE_PERCENT,
      base_vat_amount_cents: p.baseVatAmountCents,
      extras_amount_cents: p.extrasAmountCents,
      extras_vat_amount_cents: p.extrasVatAmountCents,
      total_vat_amount_cents: p.totalVatAmountCents,
      extras_selected: p.extrasSelected as unknown as Json,
      listing_id: p.listingId,
      listing_title: p.listingTitle,
      category: p.category,
      booking_date: p.date || null,
      start_time: p.startAt,
      end_time: p.endAt,
      guest_count: p.guestCount,
      customer_name: p.contact.name,
      customer_email: p.contact.email,
      customer_phone: p.contact.phone,
      guest_note: p.note || null,
      status: 'confirmed',
      // payment_status:
      //   - partner_invoice / invoice_later: 'partner_invoice_pending' (awaiting
      //     partner payout — same real-world state whether the customer typed a
      //     QR code or an admin picked the partner directly)
      //   - stripe_invoice: 'stripe_invoice_sent' (awaiting customer payment via Stripe)
      //   - stripe_recovery: 'paid' (real money came in, just manually recorded)
      //   - other internal:  'comp' (no money exchanged)
      //   - website:         'paid'
      payment_status: (p.bookingSource === 'partner_invoice' || p.bookingSource === 'invoice_later')
        ? 'partner_invoice_pending'
        : p.bookingSource === 'stripe_invoice'
          ? 'stripe_invoice_sent'
          : isStripeRecovery
            ? 'paid'
            : (isInternal ? 'comp' : 'paid'),
      currency: 'eur',
      booking_source: p.bookingSource,
      gclid: p.gclid,
      deposit_amount_cents: p.depositAmountCents,
      session_id: p.sessionId,
      campaign_id: campaignId,
      partner_id: p.partnerId,
      commission_amount_cents: p.commissionAmountCents,
      promo_code_id: p.promoCodeId,
      discount_amount_cents: p.discountAmountCents,
      stripe_invoice_id: p.stripeInvoiceId || null,
      stripe_invoice_url: p.stripeInvoiceUrl || null,
      stripe_customer_id: p.stripeCustomerId || null,
      business_profile_id: p.businessProfileId || null,
      company_name: p.companyName || null,
      company_kvk: p.companyKvk || null,
      company_vat: p.companyVat || null,
      company_address: p.companyAddress || null,
      invoice_due_date: p.invoiceDueDate || null,
    })
      .select('id')
      .single()

    if (error) {
      console.error('[book] saveToSupabase Supabase error:', error)
      return { ok: false, error: error.message ?? 'Unknown Supabase error', code: error.code }
    }

    // Non-fatal: increment uses_count + rotate if max reached.
    if (p.promoCodeId) {
      await applyPromoCodeUsage(supabase, p.promoCodeId)
    }

    return { ok: true, id: inserted.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[book] saveToSupabase exception:', err)
    return { ok: false, error: msg }
  }
}

/**
 * Bump a promo code's `uses_count` after a successful booking save, and
 * auto-rotate the code (deactivate + create a successor) when `max_uses` is hit.
 *
 * Non-fatal — caller's already saved the booking, so a failure here just means
 * the rotation didn't happen. Logged but not surfaced.
 *
 * Known limitation: the SELECT → UPDATE → maybe-INSERT sequence is NOT
 * transactional. Two simultaneous bookings using the last slot of a promo code
 * could each see `uses_count = 9`, both increment to 10, and both trigger
 * rotation — creating two successor codes. This race exists pre-refactor.
 * Fixing properly requires a Supabase RPC with row-level lock; out of scope here.
 */
async function applyPromoCodeUsage(
  supabase: ReturnType<typeof createAdminClient>,
  promoCodeId: string,
): Promise<void> {
  const { data: codeRow } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('id', promoCodeId)
    .single()
  if (!codeRow) return

  const newCount = codeRow.uses_count + 1
  await supabase
    .from('promo_codes')
    .update({ uses_count: newCount })
    .eq('id', promoCodeId)

  // Auto-rotate when max_uses reached
  if (codeRow.max_uses == null || newCount < codeRow.max_uses) return

  await supabase
    .from('promo_codes')
    .update({ is_active: false })
    .eq('id', promoCodeId)

  const newCode = generatePromoCode()
  const { data: rotated } = await supabase
    .from('promo_codes')
    .insert({
      code: newCode,
      label: codeRow.label,
      discount_type: codeRow.discount_type,
      discount_value: codeRow.discount_value,
      fixed_discount_cents: codeRow.fixed_discount_cents,
      max_uses: codeRow.max_uses,
      notes: codeRow.notes,
      partner_id: codeRow.partner_id,
    })
    .select()
    .single()

  if (rotated) {
    await notifyPromoRotation(codeRow.code, newCode, codeRow.label, codeRow.max_uses)
  }
}

/**
 * URGENT alert when Supabase save fails but Stripe already charged + FareHarbor booked.
 * The customer got their cruise but WE don't have the record.
 * This posts to Slack with ALL booking details so the admin can manually recover.
 */
async function alertBookingSaveFailure(p: BookingPayload, dbError: string) {
  // Always log locally regardless of Slack config — this is the most severe alert in
  // the codebase (money moved, boat booked, our record is missing) and must leave a
  // trail even if Slack itself is unreachable.
  console.error('[book] CRITICAL: Booking DB save failed — customer paid, FareHarbor booked, our record is missing.', { dbError, payload: p })

  const text = [
    '🚨 *CRITICAL: BOOKING DB SAVE FAILED* 🚨',
    '_Customer paid and the FareHarbor booking EXISTS — only our Supabase record failed to save._',
    '',
    `*Error:* \`${dbError}\``,
    '',
    '*Repair — add the booking row in Supabase. Do NOT recreate the FareHarbor booking:*',
    `• FareHarbor UUID: \`${p.fhBookingUuid ?? 'unknown'}\``,
    `• Stripe Payment Intent: \`${p.stripePaymentIntentId ?? 'internal'}\``,
    `• Customer: ${p.contact.name} · ${p.contact.email} · ${p.contact.phone}`,
    `• Cruise: ${p.listingTitle}`,
    `• Date: ${p.date} ${p.startAt ? '· ' + formatAmsterdamTime(p.startAt) : ''}`,
    `• Guests: ${p.guestCount} · Category: ${p.category}`,
    `• Base: €${(p.baseAmountCents / 100).toFixed(2)} · Extras: €${(p.extrasAmountCents / 100).toFixed(2)}`,
    p.note ? `• Note: ${p.note}` : '',
    '',
    '_Full payload below:_',
    '```',
    JSON.stringify(p, null, 2),
    '```',
  ].filter(Boolean).join('\n')

  // CRITICAL alert — routes to Beer's DM (falls back to the shared channel if the
  // bot token isn't configured). This is the last-line safety net for a paid,
  // FareHarbor-booked cruise whose DB row failed to save; it must not be lost.
  await postSlackCritical(text)
}

interface SlackPayload {
  listingTitle: string
  date: string
  startAt: string | null
  endAt: string | null
  guestCount: number
  category: string
  /** Selected FareHarbor customer type(s), e.g. "Diana - 2 Hours" or "2× Adult · 1× Child". */
  customerTypesLabel?: string | null
  contact: { name: string; email: string; phone: string }
  amountCents: number
  fhBookingUuid?: string
  stripePaymentIntentId: string
  extrasSelected: object[]
  totalVatAmountCents: number
  bookingSource?: BookingSource
  depositAmountCents?: number | null
  partnerInvoice?: {
    partnerName: string
    baseAmountCents: number
    commissionAmountCents: number
    commissionPercent: number
  } | null
  invoiceLater?: {
    partnerName: string
    invoiceAmountCents: number
    commissionAmountCents: number
  } | null
}

async function sendSlackNotification(p: SlackPayload) {
  const startTime = formatAmsterdamTime(p.startAt)
  const endTime = formatAmsterdamTime(p.endAt)

  const isInternal = p.bookingSource && p.bookingSource !== 'website'
  const isPartnerInvoice = p.bookingSource === 'partner_invoice' && p.partnerInvoice
  const isInvoiceLater = p.bookingSource === 'invoice_later' && p.invoiceLater
  const pi = p.partnerInvoice
  const il = p.invoiceLater

  const invoiceable = pi ? pi.baseAmountCents - pi.commissionAmountCents : 0

  const text = [
    isPartnerInvoice
      ? `*New partner-invoice booking!* 🤝 (${pi!.partnerName})`
      : isInvoiceLater
        ? `*New "invoice later" booking!* 💼 (${il!.partnerName})`
        : isInternal
          ? `*New internal booking!* 📋 (${p.bookingSource})`
          : `*New booking confirmed!* 🎉`,
    `*${p.listingTitle}*`,
    `📅 ${p.date} · ${startTime} – ${endTime}`,
    `👥 ${p.guestCount} guest${p.guestCount !== 1 ? 's' : ''} · ${p.category}`,
    p.customerTypesLabel
      ? `⛵ ${p.customerTypesLabel.includes('×') ? 'Types' : 'Type'}: ${p.customerTypesLabel}`
      : '',
    isPartnerInvoice
      ? `💰 Ticket: ${fmtAmountEur(pi!.baseAmountCents)} · To invoice: ${fmtAmountEur(invoiceable)} · Partner cut: ${fmtAmountEur(pi!.commissionAmountCents)} (${pi!.commissionPercent}%)`
      : isInvoiceLater
        ? `💰 To invoice: ${fmtAmountEur(il!.invoiceAmountCents)} · Partner cut: ${fmtAmountEur(il!.commissionAmountCents)}`
        : isInternal
          ? (p.depositAmountCents != null ? `💰 Deposit: ${fmtAmountEur(p.depositAmountCents)}` : '')
          : `💰 ${fmtAmountEur(p.amountCents)}`,
    p.extrasSelected.length > 0
      ? `📦 Extras: ${(p.extrasSelected as Array<{name: string; amount_cents: number}>).map(e => `${e.name} €${(e.amount_cents / 100).toFixed(2)}`).join(' · ')}`
      : '',
    `🧾 VAT: €${(p.totalVatAmountCents / 100).toFixed(2)}`,
    `👤 ${p.contact.name} · ${p.contact.email} · ${p.contact.phone}`,
    p.fhBookingUuid ? `🎫 FH: ${p.fhBookingUuid}` : '',
    !isInternal && p.stripePaymentIntentId ? `💳 PI: ${p.stripePaymentIntentId}` : '',
  ].filter(Boolean).join('\n')

  await postSlackText(text)
}

// ── Promo code rotation ────────────────────────────────────────────────────

const PROMO_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY3469'

function generatePromoCode(): string {
  const chars = Array.from({ length: 8 }, () => PROMO_ALPHABET[Math.floor(Math.random() * PROMO_ALPHABET.length)])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

async function notifyPromoRotation(oldCode: string, newCode: string, label: string, maxUses: number) {
  const text = [
    '🔄 *Promo code rotated*',
    `*${label}* hit its ${maxUses}-use limit.`,
    `Old code: \`${oldCode}\` → now deactivated`,
    `New code: \`${newCode}\` → now active`,
    '_Share the new code with your partners._',
  ].join('\n')

  await postSlackOps(text)
}
