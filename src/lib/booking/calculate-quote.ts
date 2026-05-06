/**
 * Server-canonical pricing.
 *
 * One function, one place — extracted from create-intent.ts so that both
 * /api/booking-flow/quote (display) and /api/booking-flow/create-intent
 * (charge) compute totals identically.
 *
 * The pipeline:
 *   1. Verify base price from FareHarbor (gross, incl. VAT).
 *   2. Fetch active extras from DB.
 *   3. calculateExtras() — per-person → per-person-per-hour → fixed → percentage.
 *   4. Add city tax (€2.60 × guests, all cruise types).
 *   5. Apply promo discount (capped to total).
 *   6. Floor at 50 cents (Stripe minimum).
 *
 * NEVER trusts client-supplied amounts. Inputs are the booking selection;
 * outputs are the canonical totals.
 */

import { getFareHarborClient } from '@/lib/fareharbor/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateExtras, type ExtrasCalculation, type Extra } from '@/lib/extras/calculate'
import { DEFAULT_DURATION_MINUTES } from '@/lib/constants'

export interface QuoteInput {
  listingId: string
  availPk: number
  customerTypeRatePk: number
  guestCount: number
  category: string                       // 'private' | 'shared' | 'standard'
  durationMinutes?: number
  selectedExtraIds?: string[]
  extraQuantities?: Record<string, number>
  promoCodeId?: string | null
  /**
   * Discount amount in cents, computed by /api/promo/validate on the client.
   * The server caps this to the pre-discount total — it never trusts a value
   * larger than what's owed. A future improvement is to re-fetch the promo
   * code and compute the discount entirely server-side.
   */
  discountAmountCents?: number
}

export interface QuoteResult {
  basePriceCents: number              // FH-verified per-rate gross price
  serverBaseAmount: number            // basePriceCents OR basePriceCents × guestCount (shared)
  extrasCalculation: ExtrasCalculation
  cityTaxCents: number
  discountAmountCents: number
  totalCents: number                  // final amount (≥50 cents)
  durationMinutes: number
}

const CITY_TAX_PER_GUEST_CENTS = 260
const STRIPE_MIN_CENTS = 50

/**
 * Compute the canonical price for a booking selection. Pure function that
 * fetches FH availability + extras and returns totals. No DB writes, no
 * Stripe calls — caller decides what to do with the result.
 */
export async function calculateQuote(input: QuoteInput): Promise<QuoteResult> {
  const {
    availPk,
    customerTypeRatePk,
    guestCount,
    category,
    durationMinutes = DEFAULT_DURATION_MINUTES,
    selectedExtraIds = [],
    extraQuantities = {},
    discountAmountCents: rawDiscount = 0,
  } = input

  // 1. Verify base price from FareHarbor (gross, incl. VAT).
  //    Using `total` (NET) instead of `total_including_tax` would under-charge by 9%.
  const fh = getFareHarborClient()
  const availDetail = await fh.getAvailabilityDetail(availPk)
  const matchingRate = availDetail.customer_type_rates?.find(
    (r: { pk: number }) => r.pk === customerTypeRatePk,
  )
  const verifiedBaseCents =
    matchingRate?.customer_prototype?.total_including_tax
    ?? matchingRate?.customer_prototype?.total
    ?? 0

  if (verifiedBaseCents <= 0) {
    throw new Error(
      `Could not verify price for customer type rate ${customerTypeRatePk} on availability ${availPk}.`,
    )
  }

  // For shared cruises, FH returns per-person rates → multiply by guest count.
  // For private, the rate IS the boat price → keep as-is.
  const isPrivate = category === 'private'
  const serverBaseAmount = isPrivate ? verifiedBaseCents : verifiedBaseCents * guestCount

  // 2. Fetch active extras from the DB (only the ones the user selected).
  //    Filtering by is_active means a deactivated extra silently drops — we
  //    log the count mismatch below for forensics.
  //    NOTE: use createAdminClient (raw service role, no cookies) — the
  //    cookie-aware createServiceClient picks up the user's auth role and
  //    falls foul of the extras table's `authenticated`-less RLS policy,
  //    silently returning 0 rows for logged-in admins/partners.
  const supabase = createAdminClient()
  const extrasResult = selectedExtraIds.length > 0
    ? await supabase.from('extras').select('*').in('id', selectedExtraIds).eq('is_active', true)
    : { data: [] as Extra[], error: null }

  if (extrasResult.error) {
    throw new Error(`Failed to fetch extras: ${extrasResult.error.message}`)
  }
  const extras = (extrasResult.data ?? []) as Extra[]

  if (selectedExtraIds.length !== extras.length) {
    const missing = selectedExtraIds.filter(id => !extras.some(e => e.id === id))
    console.warn('[calculate-quote] dropped inactive/missing extras', {
      requested: selectedExtraIds.length,
      found: extras.length,
      missing,
    })
  }

  // 3. Calculate extras — same function the frontend uses for live UI feedback.
  const quantities = new Map(Object.entries(extraQuantities))
  const extrasCalculation = calculateExtras(
    serverBaseAmount,
    guestCount,
    extras,
    durationMinutes,
    quantities,
  )

  // 4. City tax (municipality levy, not in FareHarbor — applies to all cruise types).
  const cityTaxCents = guestCount * CITY_TAX_PER_GUEST_CENTS

  // 5. Apply promo discount, capped to the pre-discount total.
  const totalBeforeDiscount = extrasCalculation.grand_total_cents + cityTaxCents
  const discountAmountCents = Math.max(0, Math.min(rawDiscount, totalBeforeDiscount))

  // 6. Floor at Stripe minimum (€0.50).
  const totalCents = Math.max(STRIPE_MIN_CENTS, totalBeforeDiscount - discountAmountCents)

  return {
    basePriceCents: verifiedBaseCents,
    serverBaseAmount,
    extrasCalculation,
    cityTaxCents,
    discountAmountCents,
    totalCents,
    durationMinutes,
  }
}
