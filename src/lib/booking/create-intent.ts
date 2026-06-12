import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateQuote } from '@/lib/booking/calculate-quote'
import { type ExtrasCalculation } from '@/lib/extras/calculate'
import { fmtEuros } from '@/lib/utils'
import { toClickType } from '@/lib/tracking/click-ids'

interface CreateIntentInput {
  /**
   * Required: the server-issued quoteId from /api/booking-flow/quote.
   * The quote is the source of truth for the charge amount — we never trust
   * client-supplied prices.
   */
  quoteId: string
  listingTitle: string
  date: string
  /** ISO datetime of departure — stored in PI metadata for webhook recovery. */
  startAt?: string | null
  /** ISO datetime of cruise end — stored in PI metadata for webhook recovery. */
  endAt?: string | null
  contact: { name: string; email: string; phone?: string }
  /** Google ad click id value (oc_gclid cookie) — the Google Ads conversion key. */
  gclid?: string | null
  /** Which kind of click id (gclid/wbraid/gbraid) — selects the upload field. */
  clickType?: string | null
  /** Whether the visitor accepted the tracking banner — gates send-to-Google. */
  marketingConsent?: boolean
  /** Derived traffic channel (google-ads/campaign/social/organic/…) — see
   *  src/lib/tracking/traffic-source.ts. Stored in PI metadata for attribution. */
  trafficSource?: string | null
  /** The specific origin: campaign slug, utm_source, or referrer host. */
  trafficDetail?: string | null
  /** Analytics session id (cookie or stable-per-tab anon). Stored in PI metadata
   *  so the webhook can link the booking to its originating visit (device, channel). */
  sessionId?: string | null
}

interface CreateIntentResult {
  clientSecret: string
  calculation: ExtrasCalculation
  discountAmountCents: number
  chargedCents: number
}

/**
 * Create a Stripe PaymentIntent against a server-issued price quote.
 *
 * Flow:
 *   1. Look up the quote in `pricing_quotes` by id.
 *   2. Reject if expired or already consumed.
 *   3. Recompute the quote inputs server-side (defence-in-depth — should match).
 *   4. Charge the recomputed total via Stripe.
 *   5. Mark the quote consumed.
 */
export async function createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
  const { quoteId, listingTitle, date, startAt, endAt, contact, gclid, clickType, marketingConsent, sessionId, trafficSource, trafficDetail } = input

  if (!quoteId) {
    throw new Error('Missing quoteId — please refresh your booking and try again.')
  }

  const supabase = createAdminClient()

  // 1. Look up the quote
  const { data: quoteRow, error: quoteError } = await supabase
    .from('pricing_quotes')
    .select('*')
    .eq('id', quoteId)
    .maybeSingle()

  if (quoteError || !quoteRow) {
    throw new Error('Your price quote could not be found. Please refresh your booking and try again.')
  }

  // 2. Validate freshness
  const now = new Date()
  if (new Date(quoteRow.expires_at) < now) {
    throw new Error('Your price quote has expired. Please refresh your booking and try again.')
  }
  if (quoteRow.consumed_at) {
    throw new Error('This quote has already been used. Please refresh your booking and try again.')
  }

  // 3. Defence-in-depth: re-run the calculation with the same inputs.
  //    If it differs, refuse — something changed (price, deactivated extra) since
  //    the quote was issued.
  const recomputed = await calculateQuote({
    listingId: String(quoteRow.listing_id ?? ''),
    availPk: Number(quoteRow.avail_pk),
    customerTypeRatePk: Number(quoteRow.customer_type_rate_pk ?? 0),
    guestCount: Number(quoteRow.guest_count),
    category: String(quoteRow.category),
    durationMinutes: Number(quoteRow.duration_minutes),
    selectedExtraIds: (quoteRow.selected_extra_ids as string[]) ?? [],
    extraQuantities: (quoteRow.extra_quantities as Record<string, number>) ?? {},
    promoCodeId: quoteRow.promo_code_id,
    discountAmountCents: Number(quoteRow.discount_amount_cents ?? 0),
  })

  if (recomputed.totalCents !== quoteRow.total_cents) {
    console.error('[create-intent] quote total drift detected', {
      quoteId,
      stored: quoteRow.total_cents,
      recomputed: recomputed.totalCents,
    })
    throw new Error(
      'The price changed since you saw this booking. Please refresh and review the new total.',
    )
  }

  if (recomputed.totalCents < 50) {
    throw new Error('Amount must be at least €0.50')
  }

  // 4. Create Stripe PaymentIntent against the recomputed total.
  const extrasSummary = recomputed.extrasCalculation.line_items
    .map(li => `${li.name} (${fmtEuros(li.amount_cents)})`)
    .join(', ')

  const paymentIntent = await getStripe().paymentIntents.create({
    amount: recomputed.totalCents,
    currency: 'eur',
    payment_method_types: ['card', 'ideal', 'link'],
    metadata: {
      quote_id: String(quoteId),
      listing_title: String(listingTitle ?? ''),
      listing_id: String(quoteRow.listing_id ?? ''),
      avail_pk: String(quoteRow.avail_pk),
      customer_type_rate_pk: String(quoteRow.customer_type_rate_pk ?? ''),
      customer_type_name: String(recomputed.customerTypeName ?? ''),
      guest_count: String(quoteRow.guest_count),
      category: String(quoteRow.category),
      date: String(date ?? ''),
      start_at: String(startAt ?? ''),
      end_at: String(endAt ?? ''),
      guest_name: String(contact?.name ?? ''),
      guest_email: String(contact?.email ?? ''),
      guest_phone: String(contact?.phone ?? ''),
      extras_summary: extrasSummary,
      // Price breakdown — needed by the webhook safety net to recreate the booking
      // when the browser-side flow fails (e.g. browser closed after iDEAL redirect).
      server_base_amount_cents: String(recomputed.serverBaseAmount),
      extras_amount_cents: String(recomputed.extrasCalculation.extras_amount_cents),
      base_vat_amount_cents: String(recomputed.extrasCalculation.base_vat_amount_cents),
      extras_vat_amount_cents: String(recomputed.extrasCalculation.extras_vat_amount_cents),
      total_vat_amount_cents: String(recomputed.extrasCalculation.total_vat_amount_cents),
      city_tax_cents: String(recomputed.cityTaxCents),
      // Google Ads attribution: gclid is the conversion key; consent_marketing
      // gates whether the Stripe webhook may forward the conversion to Google.
      consent_marketing: marketingConsent ? 'yes' : 'no',
      ...(sessionId ? { session_id: String(sessionId) } : {}),
      ...(gclid ? { gclid: String(gclid), click_type: toClickType(clickType) } : {}),
      // Where the customer came from (first-party attribution, derived at checkout)
      ...(trafficSource ? { traffic_source: String(trafficSource).slice(0, 100) } : {}),
      ...(trafficDetail ? { traffic_detail: String(trafficDetail).slice(0, 200) } : {}),
      ...(quoteRow.promo_code_id
        ? {
            promo_code_id: String(quoteRow.promo_code_id),
            discount_amount_cents: String(recomputed.discountAmountCents),
          }
        : {}),
    },
  })

  // 5. Mark the quote consumed (best-effort; ignore failure — Stripe is the source of truth)
  await supabase
    .from('pricing_quotes')
    .update({ consumed_at: now.toISOString(), consumed_intent_id: paymentIntent.id })
    .eq('id', quoteId)

  console.log('[create-intent] charge', {
    quoteId,
    intentId: paymentIntent.id,
    chargedCents: recomputed.totalCents,
    cityTax: recomputed.cityTaxCents,
    extrasAmount: recomputed.extrasCalculation.extras_amount_cents,
    discount: recomputed.discountAmountCents,
  })

  return {
    clientSecret: paymentIntent.client_secret!,
    calculation: recomputed.extrasCalculation,
    discountAmountCents: recomputed.discountAmountCents,
    chargedCents: recomputed.totalCents,
  }
}
