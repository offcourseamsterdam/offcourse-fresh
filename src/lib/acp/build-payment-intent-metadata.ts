import type { QuoteResult } from '@/lib/booking/calculate-quote'
import type { ResolvedCheckout } from './resolve-checkout-items'

export interface AcpBuyer {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

/**
 * Builds the exact PaymentIntent metadata schema the Stripe webhook
 * (src/app/api/webhooks/stripe/route.ts) reads to create the FareHarbor
 * booking — same field names as the regular checkout's create-intent.ts,
 * so an ACP-originated payment is finalized by the *same* code path with no
 * new booking-creation logic. `avail_pk` is the field the webhook uses to
 * recognize "this is one of our checkout PaymentIntents" at all.
 *
 * `acp_checkout_session_id` is the one field this schema adds — the webhook
 * uses it (additively, see that file) to flip this ACP session to
 * `completed` once the booking is actually confirmed.
 */
export function buildPaymentIntentMetadata(
  sessionId: string,
  checkout: ResolvedCheckout,
  quote: QuoteResult,
  buyer: AcpBuyer
): Record<string, string> {
  const guestName = [buyer.first_name, buyer.last_name].filter(Boolean).join(' ').trim()

  return {
    acp_checkout_session_id: sessionId,
    quote_id: `acp:${sessionId}`,
    listing_title: checkout.listingTitle,
    listing_id: checkout.listingId,
    avail_pk: String(checkout.availPk),
    customer_type_rate_pk: String(checkout.primaryCustomerTypeRatePk),
    customer_type_name: String(quote.customerTypeName ?? ''),
    guest_count: String(checkout.guestCount),
    ...(checkout.customerTypeRates.length > 1
      ? { customer_type_rates: JSON.stringify(checkout.customerTypeRates) }
      : {}),
    category: checkout.category,
    date: checkout.date,
    start_at: checkout.startAt,
    end_at: checkout.endAt,
    guest_name: guestName,
    guest_email: String(buyer.email ?? ''),
    guest_phone: String(buyer.phone ?? ''),
    extras_summary: '',
    server_base_amount_cents: String(quote.serverBaseAmount),
    extras_amount_cents: String(quote.extrasCalculation.extras_amount_cents),
    base_vat_amount_cents: String(quote.extrasCalculation.base_vat_amount_cents),
    extras_vat_amount_cents: String(quote.extrasCalculation.extras_vat_amount_cents),
    total_vat_amount_cents: String(quote.extrasCalculation.total_vat_amount_cents),
    city_tax_cents: String(quote.cityTaxCents),
    // ACP has no marketing-consent checkbox in its buyer schema — default closed.
    consent_marketing: 'no',
  }
}
