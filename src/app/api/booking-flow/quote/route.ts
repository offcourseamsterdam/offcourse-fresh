import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'
import { calculateQuote } from '@/lib/booking/calculate-quote'
import { DEFAULT_DURATION_MINUTES } from '@/lib/constants'

/**
 * POST /api/booking-flow/quote
 *
 * Server-canonical pricing endpoint. Given a booking selection (listing,
 * availability, guests, extras, optional promo), returns the authoritative
 * total to display to the user AND a quoteId to pass to /create-intent.
 *
 * The quote is stored in `pricing_quotes` (TTL 10 min) so create-intent can
 * reference it by id without re-trusting any client value.
 *
 * Public endpoint, no auth — same trust model as availability/promo lookups.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      listingId,
      availPk,
      customerTypeRatePk,
      guestCount,
      category,
      durationMinutes = DEFAULT_DURATION_MINUTES,
      selectedExtraIds = [],
      extraQuantities = {},
      promoCodeId,
      discountAmountCents,
    } = body

    if (!listingId || !availPk || !customerTypeRatePk) {
      return apiError('Missing required fields (listingId, availPk, customerTypeRatePk)', 400)
    }
    if (!Number.isFinite(Number(guestCount)) || Number(guestCount) < 1) {
      return apiError('guestCount must be a positive integer', 400)
    }

    console.log('[quote] request', {
      listingId,
      availPk,
      customerTypeRatePk,
      guestCount,
      category,
      durationMinutes,
      selectedExtraIds,
      extraQuantities,
      promoCodeId,
    })

    const quote = await calculateQuote({
      listingId,
      availPk: Number(availPk),
      customerTypeRatePk: Number(customerTypeRatePk),
      guestCount: Number(guestCount),
      category: String(category ?? ''),
      durationMinutes: Number(durationMinutes),
      selectedExtraIds: Array.isArray(selectedExtraIds) ? selectedExtraIds : [],
      extraQuantities: extraQuantities && typeof extraQuantities === 'object' ? extraQuantities : {},
      promoCodeId: promoCodeId ?? null,
      discountAmountCents: discountAmountCents != null ? Number(discountAmountCents) : 0,
    })

    // Persist the quote so create-intent can reference it by id.
    const supabase = await createServiceClient()
    const { data: quoteRow, error: insertError } = await supabase
      .from('pricing_quotes')
      .insert({
        listing_id: listingId,
        avail_pk: Number(availPk),
        customer_type_rate_pk: Number(customerTypeRatePk),
        guest_count: Number(guestCount),
        category: String(category ?? ''),
        duration_minutes: quote.durationMinutes,
        selected_extra_ids: selectedExtraIds,
        extra_quantities: extraQuantities,
        promo_code_id: promoCodeId ?? null,
        base_price_cents: quote.basePriceCents,
        server_base_amount_cents: quote.serverBaseAmount,
        extras_amount_cents: quote.extrasCalculation.extras_amount_cents,
        city_tax_cents: quote.cityTaxCents,
        discount_amount_cents: quote.discountAmountCents,
        total_cents: quote.totalCents,
        // Stored as jsonb — full breakdown so the UI can render line items without recomputing
        breakdown: JSON.parse(JSON.stringify({
          extrasCalculation: quote.extrasCalculation,
          basePriceCents: quote.basePriceCents,
          serverBaseAmount: quote.serverBaseAmount,
          cityTaxCents: quote.cityTaxCents,
          discountAmountCents: quote.discountAmountCents,
          totalCents: quote.totalCents,
        })),
      })
      .select('id, expires_at')
      .single()

    if (insertError || !quoteRow) {
      console.error('[quote] failed to persist quote', insertError)
      return apiError('Could not generate quote — please refresh and try again')
    }

    console.log('[quote] issued', {
      quoteId: quoteRow.id,
      listingId,
      guestCount: Number(guestCount),
      duration: quote.durationMinutes,
      extras: selectedExtraIds.length,
      total: quote.totalCents,
      cityTax: quote.cityTaxCents,
      extrasAmount: quote.extrasCalculation.extras_amount_cents,
    })

    return apiOk({
      quoteId: quoteRow.id,
      expiresAt: quoteRow.expires_at,
      basePriceCents: quote.basePriceCents,
      serverBaseAmountCents: quote.serverBaseAmount,
      extrasCalculation: quote.extrasCalculation,
      cityTaxCents: quote.cityTaxCents,
      discountAmountCents: quote.discountAmountCents,
      totalCents: quote.totalCents,
      durationMinutes: quote.durationMinutes,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[quote] error', message)
    return apiError(message)
  }
}
