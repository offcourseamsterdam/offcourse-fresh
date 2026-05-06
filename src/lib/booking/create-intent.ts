import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateQuote } from '@/lib/booking/calculate-quote'
import { type ExtrasCalculation } from '@/lib/extras/calculate'
import { fmtEuros } from '@/lib/utils'

interface CreateIntentInput {
  /**
   * Required: the server-issued quoteId from /api/booking-flow/quote.
   * The quote is the source of truth for the charge amount — we never trust
   * client-supplied prices.
   */
  quoteId: string
  listingTitle: string
  date: string
  contact: { name: string; email: string; phone?: string }
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
  const { quoteId, listingTitle, date, contact } = input

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
      guest_count: String(quoteRow.guest_count),
      category: String(quoteRow.category),
      date: String(date ?? ''),
      guest_name: String(contact?.name ?? ''),
      guest_email: String(contact?.email ?? ''),
      guest_phone: String(contact?.phone ?? ''),
      extras_summary: extrasSummary,
      city_tax_cents: String(recomputed.cityTaxCents),
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
