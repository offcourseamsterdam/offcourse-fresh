import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import type { FHBookingResponse } from '@/lib/fareharbor/types'
import { resolveCustomerTypeName } from '@/lib/fareharbor/customer-type-name'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'
import type { BookingSource } from '@/lib/constants'
import { requireAdmin } from '@/lib/auth/require-admin'
import { normalizePartnerCode } from '@/lib/partner-codes/generate'
import { validatePartnerCode, reasonMessage } from '@/lib/partner-codes/validate'
import { sendConfirmationEmail } from '@/lib/booking/send-confirmation-email'
import { notifyCateringOrder } from '@/lib/catering/notify'
import { notifyBookingFailure } from '@/lib/booking/notify-booking-failure'
import { extractVat } from '@/lib/extras/calculate'
import { formatAmsterdamTime } from '@/lib/utils'
import { postSlackText } from '@/lib/slack/send-notification'
import type { Json } from '@/lib/supabase/types'

// ── Constants ──────────────────────────────────────────────────────────────

/** Amsterdam city tax per guest (€2.60). Charged on every booking; 0% VAT (municipal levy). */
const CITY_TAX_CENTS_PER_GUEST = 260

/** Standard NL cruise VAT rate (9% — tourism / transport). */
const BASE_VAT_RATE_PERCENT = 9

/** Fallback VAT rate for extras when not provided per-item (most are drinks at 21%). */
const DEFAULT_EXTRAS_VAT_RATE_PERCENT = 21

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

    // Internal booking sources (partner_invoice, stripe_recovery, withlocals, etc.)
    // bypass Stripe payment verification and create real FareHarbor bookings and
    // consume boat capacity. Gate them behind admin auth so only authenticated admin
    // users can trigger them. Website bookings stay unauthenticated — that's the
    // public customer checkout path.
    if (isInternal) {
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

    // ── Campaign attribution & commission ──────────────────────────────────
    // Resolves to one of three sources, in this precedence (last wins):
    //   1. Cookie (oc_attr) — passive attribution from a tracked visit (website only)
    //   2. Promo code with campaign_id — explicit code-scoped attribution
    //   3. Partner-invoice context — always wins when present
    //
    // Cookie attribution is intentionally skipped for non-website sources (GetYourGuide,
    // WithLocals, stripe_recovery, etc.) — those bookings are entered by an admin whose
    // browser may carry a partner cookie unrelated to the actual booking channel.
    // Platform auto-attribution still runs via resolveCampaignId in saveToSupabase.
    const { campaignId: cookieCampaignId, partnerId, commissionAmountCents } = await resolveAttribution({
      attrCookie: bookingSource === 'website' ? (request.cookies.get('oc_attr')?.value ?? null) : null,
      promoCodeId: promoCodeId ?? null,
      partnerInvoiceContext,
      baseAmountCents: Number(baseAmountCents ?? 0),
    })

    // Idempotency: if a booking already exists for this payment intent, return it (website only)
    if (stripePaymentIntentId) {
      const supabase = createAdminClient()
      const { data: existing } = await supabase
        .from('bookings')
        .select('id, fareharbor_booking_uuid')
        .eq('stripe_payment_intent_id', stripePaymentIntentId)
        .maybeSingle()
      if (existing) {
        return apiOk({ booking: existing, deduplicated: true })
      }
    }

    const fh = getFareHarborClient()

    // Private boats: book the boat once (quantity=1) — the customer type rate IS the duration.
    // Shared boats: each guest is a separate customer entry.
    const isPrivate = category === 'private'
    const customerCount = isPrivate ? 1 : Number(guestCount)

    const customers = Array.from({ length: customerCount }, () => ({
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
    if (!isInternal && stripePaymentIntentId) {
      try {
        const pi = await getStripe().paymentIntents.retrieve(String(stripePaymentIntentId))
        piSessionId = pi.metadata?.session_id ?? null
      } catch (err) {
        console.error('[book] could not read session_id from PaymentIntent metadata:', err)
      }
    }
    const sessionId = pickBookingSessionId(piSessionId, body.sessionId as string | null)

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
    )

    const saveResult = await saveToSupabase(bookingPayload)
    if (!saveResult.ok) {
      // URGENT: customer paid, boat is reserved, but we have no DB record.
      // Alert so an admin can manually recover within minutes.
      await alertBookingSaveFailure(bookingPayload, saveResult.error)
      // Still return success to customer — they got what they paid for.
    }

    // Step 3b: Non-critical notifications — run concurrently, fail quietly
    await Promise.allSettled([
      notifyCateringOrder({
        cruiseName: String(listingTitle ?? ''),
        dateStr: String(date ?? ''),
        startTimeStr: startAt ?? null,
        guestCount: Number(guestCount),
        extrasSelected: (extrasSelected ?? []) as never,
      }),
      sendSlackNotification({
        listingTitle: String(listingTitle ?? ''),
        date: String(date ?? ''),
        startAt: startAt ?? null,
        endAt: endAt ?? null,
        guestCount: Number(guestCount),
        category: String(category ?? ''),
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
      }),
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

    return apiOk({ booking })
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
    depositAmountCents: (isInternal && !isStripeRecovery) ? Number(body.depositAmountCents ?? 0) : null,
    sessionId: attribution.sessionId,
    cookieCampaignId: attribution.campaignId,
    partnerId: attribution.partnerId,
    commissionAmountCents: attribution.commissionAmountCents,
    gclid: attribution.gclid,
    promoCodeId: (body.promoCodeId as string | null) ?? null,
    discountAmountCents: Number(body.discountAmountCents ?? 0),
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

/**
 * Compute the commission amount (in cents) for a campaign given a base price.
 *
 * Quirk: when `investment_type === 'fixed_amount'` the fixed cents amount is
 * stored in the `percentage_value` column too (the column is reused). Preserve
 * that semantic — it's not a bug, it's how the schema is.
 *
 * Returns `null` when the campaign has no valid commission setup (missing value,
 * unknown investment_type) so the caller can leave `commission_amount_cents`
 * NULL in the DB instead of writing 0.
 *
 * Exported for unit testing.
 */
export function commissionForCampaign(
  campaign: { percentage_value: number | null; investment_type: string | null } | null | undefined,
  baseAmountCents: number,
): number | null {
  if (!campaign?.percentage_value) return null
  if (campaign.investment_type === 'percentage') {
    return Math.round(baseAmountCents * campaign.percentage_value / 100)
  }
  if (campaign.investment_type === 'fixed_amount') {
    return Math.round(campaign.percentage_value)
  }
  return null
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
async function resolveAttribution(params: {
  attrCookie: string | null
  promoCodeId: string | null
  partnerInvoiceContext: PartnerInvoiceContext | null
  baseAmountCents: number
}): Promise<{ campaignId: string | null; partnerId: string | null; commissionAmountCents: number | null }> {
  let campaignId: string | null = null
  let partnerId: string | null = null
  let commissionAmountCents: number | null = null

  // Layer 1: cookie attribution
  try {
    if (params.attrCookie) {
      const attr = JSON.parse(params.attrCookie)
      if (attr.campaign_id) {
        const supabase = createAdminClient()
        const { data: campaign } = await supabase
          .from('campaigns')
          .select('percentage_value, investment_type')
          .eq('id', attr.campaign_id)
          .maybeSingle()
        if (campaign) {
          campaignId = attr.campaign_id
          partnerId = attr.partner_id ?? null
          commissionAmountCents = commissionForCampaign(campaign, params.baseAmountCents)
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
        const { data: campaign } = await supabase
          .from('campaigns')
          .select('id, partner_id, percentage_value, investment_type')
          .eq('id', promoRow.campaign_id)
          .maybeSingle()
        if (campaign) {
          campaignId = campaign.id
          partnerId = campaign.partner_id ?? null
          commissionAmountCents = commissionForCampaign(campaign, params.baseAmountCents)
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Layer 3: partner-invoice context (highest priority)
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

  return { campaignId, partnerId, commissionAmountCents }
}

/**
 * Save booking to Supabase. Returns success flag + error details.
 * Caller is responsible for alerting on failure — this is the money-path,
 * we MUST know when it breaks.
 */
async function saveToSupabase(p: BookingPayload): Promise<{ ok: true } | { ok: false; error: string }> {
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
    const { error } = await supabase.from('bookings').insert({
      booking_id: bookingId,
      booking_uuid: p.fhBookingUuid ?? null,
      fareharbor_availability_pk: p.availPk,
      fareharbor_customer_type_rate_pk: p.customerTypeRatePk,
      customer_type_name: customerTypeName,
      stripe_payment_intent_id: p.stripePaymentIntentId,
      // Stripe recovery: use the admin-entered amount (real revenue). Other internal: 0.
      // Website: compute from base + extras + city tax − discount.
      stripe_amount: isStripeRecovery
        ? p.amountCents
        : isInternal
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
      //   - partner_invoice: 'partner_invoice_pending' (awaiting partner payout)
      //   - stripe_recovery: 'paid' (real money came in, just manually recorded)
      //   - other internal:  'comp' (no money exchanged)
      //   - website:         'paid'
      payment_status: p.bookingSource === 'partner_invoice'
        ? 'partner_invoice_pending'
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
    })

    if (error) {
      console.error('[book] saveToSupabase Supabase error:', error)
      return { ok: false, error: error.message ?? 'Unknown Supabase error' }
    }

    // Non-fatal: increment uses_count + rotate if max reached.
    if (p.promoCodeId) {
      await applyPromoCodeUsage(supabase, p.promoCodeId)
    }

    return { ok: true }
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
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) {
    console.error('[book] CRITICAL: Booking save failed AND no Slack webhook configured!', { dbError, payload: p })
    return
  }

  const text = [
    '🚨 *CRITICAL: BOOKING SAVE FAILED* 🚨',
    '_Customer paid + FareHarbor booked, but NOT in Supabase._',
    '',
    `*Error:* \`${dbError}\``,
    '',
    '*Manually recover this booking:*',
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

  await postSlackText(text)
}

function fmtAmountEur(cents: number) {
  return `€${(cents / 100).toFixed(0)}`
}

interface SlackPayload {
  listingTitle: string
  date: string
  startAt: string | null
  endAt: string | null
  guestCount: number
  category: string
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
}

async function sendSlackNotification(p: SlackPayload) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return // not configured

  const startTime = formatAmsterdamTime(p.startAt)
  const endTime = formatAmsterdamTime(p.endAt)

  const isInternal = p.bookingSource && p.bookingSource !== 'website'
  const isPartnerInvoice = p.bookingSource === 'partner_invoice' && p.partnerInvoice
  const pi = p.partnerInvoice

  const invoiceable = pi ? pi.baseAmountCents - pi.commissionAmountCents : 0

  const text = [
    isPartnerInvoice
      ? `*New partner-invoice booking!* 🤝 (${pi!.partnerName})`
      : isInternal
        ? `*New internal booking!* 📋 (${p.bookingSource})`
        : `*New booking confirmed!* 🎉`,
    `*${p.listingTitle}*`,
    `📅 ${p.date} · ${startTime} – ${endTime}`,
    `👥 ${p.guestCount} guest${p.guestCount !== 1 ? 's' : ''} · ${p.category}`,
    isPartnerInvoice
      ? `💰 Ticket: ${fmtAmountEur(pi!.baseAmountCents)} · To invoice: ${fmtAmountEur(invoiceable)} · Partner cut: ${fmtAmountEur(pi!.commissionAmountCents)} (${pi!.commissionPercent}%)`
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
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  const text = [
    '🔄 *Promo code rotated*',
    `*${label}* hit its ${maxUses}-use limit.`,
    `Old code: \`${oldCode}\` → now deactivated`,
    `New code: \`${newCode}\` → now active`,
    '_Share the new code with your partners._',
  ].join('\n')

  await postSlackText(text)
}
