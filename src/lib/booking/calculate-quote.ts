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
import { isChildLabel } from '@/lib/booking/adult-count'
import { CITY_TAX_CENTS_PER_GUEST as CITY_TAX_PER_GUEST_CENTS } from '@/lib/booking/constants'
import { DEFAULT_DURATION_MINUTES } from '@/lib/constants'
import { validatePromoCodeById, type ValidationResult } from '@/lib/promo-codes/validate'
import { applyPromoCode } from '@/lib/promo-codes/apply'

export interface QuoteInput {
  listingId: string
  availPk: number
  customerTypeRatePk: number
  guestCount: number
  category: string                       // 'private' | 'shared' | 'standard'
  durationMinutes?: number
  selectedExtraIds?: string[]
  extraQuantities?: Record<string, number>
  /**
   * The promo code's id (from /api/promo/validate). The discount is re-derived
   * server-side from this id — the client's displayed discount amount is NEVER
   * trusted (2026-07 security fix). No id → no discount.
   */
  promoCodeId?: string | null
  /**
   * For shared cruises with multiple ticket types (e.g. adult + child).
   * When provided, the server verifies each rate individually and sums the
   * totals — fixing the bug where child tickets were priced as adults.
   * Not used for private cruises (the rate IS the whole boat price).
   */
  customerTypeRates?: Array<{ pk: number; count: number }>
}

export interface QuoteResult {
  basePriceCents: number              // FH-verified per-rate gross price
  serverBaseAmount: number            // basePriceCents OR basePriceCents × guestCount (shared)
  extrasCalculation: ExtrasCalculation
  cityTaxCents: number
  discountAmountCents: number
  totalCents: number                  // final amount (≥50 cents)
  durationMinutes: number
  customerTypeName: string | null     // FH customer-type label, e.g. "Diana - 2 Hours"
}

const STRIPE_MIN_CENTS = 50

export interface QuoteDeps {
  /** Injectable promo validation (by id) for tests. Defaults to the real DB-backed one. */
  validatePromo?: (id: string, opts: { listingId?: string | null }) => Promise<ValidationResult>
}

/**
 * Compute the canonical price for a booking selection. Fetches FH availability +
 * extras and returns totals. No DB writes, no Stripe calls — caller decides what
 * to do with the result. The promo discount is always derived server-side from
 * the promo code id; client-supplied amounts are never trusted.
 */
export async function calculateQuote(input: QuoteInput, deps: QuoteDeps = {}): Promise<QuoteResult> {
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
    customerTypeRates,
  } = input

  // 1. Verify base price from FareHarbor (gross, incl. VAT).
  //    Using `total` (NET) instead of `total_including_tax` would under-charge by 9%.
  const fh = getFareHarborClient()
  const availDetail = await fh.getAvailabilityDetail(availPk)

  const isPrivate = category === 'private'

  let verifiedBaseCents: number
  let serverBaseAmount: number
  let customerTypeName: string | null
  // Headcount used to price adults_only extras (e.g. Unlimited Drinks). For shared
  // cruises we count only the non-child ticket types; private has no child concept.
  let adultCount = guestCount

  if (!isPrivate && customerTypeRates && customerTypeRates.length > 0) {
    // Shared cruise with multiple ticket types (e.g. adult + child).
    // Verify each rate individually and sum — fixes child-as-adult mispricing.
    serverBaseAmount = 0
    customerTypeName = null
    adultCount = 0
    for (const { pk, count } of customerTypeRates) {
      const rate = availDetail.customer_type_rates?.find((r: { pk: number }) => r.pk === pk)
      if (!rate) throw new Error(`Could not find customer type rate ${pk} on availability ${availPk}`)
      const priceCents =
        rate.customer_prototype?.total_including_tax ?? rate.customer_prototype?.total ?? 0
      if (priceCents <= 0) throw new Error(`Could not verify price for customer type rate ${pk}`)
      serverBaseAmount += priceCents * count
      if (pk === customerTypeRatePk) customerTypeName = rate.customer_type?.singular ?? null
      if (!isChildLabel(rate.customer_type?.singular)) adultCount += count
    }
    verifiedBaseCents = serverBaseAmount
  } else {
    // Private booking or single-rate shared — original path.
    const matchingRate = availDetail.customer_type_rates?.find(
      (r: { pk: number }) => r.pk === customerTypeRatePk,
    )
    // The human-readable label the guest picked (e.g. "Diana - 2 Hours"). Snapshotted
    // onto the booking so we never have to map the volatile rate PK back to a name.
    customerTypeName = matchingRate?.customer_type?.singular ?? null
    verifiedBaseCents =
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
    serverBaseAmount = isPrivate ? verifiedBaseCents : verifiedBaseCents * guestCount
  }

  // 2. Fetch active extras from the DB (only the ones the user selected).
  //    Filtering by is_active means a deactivated extra silently drops — we
  //    log the count mismatch below for forensics.
  //    NOTE: use createAdminClient (raw service role, no cookies) — a
  //    cookie-aware client picks up the user's auth role and falls foul of
  //    the extras table's `authenticated`-less RLS policy, silently
  //    returning 0 rows for logged-in admins/partners.
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

  // Enforce min_people on per-person-pick extras: qty must satisfy qty ≥ min_people.
  // No upper cap — customers/admin can over-order (e.g. 8 portions on a 6-guest booking).
  for (const extra of extras) {
    if (extra.price_type !== 'per_person_cents') continue
    if (!extra.min_people || extra.min_people <= 0) continue
    const qty = quantities.get(extra.id) ?? 0
    if (qty < extra.min_people) {
      throw new Error(`${extra.name} requires a minimum of ${extra.min_people} people`)
    }
  }

  const extrasCalculation = calculateExtras(
    serverBaseAmount,
    guestCount,
    extras,
    durationMinutes,
    quantities,
    adultCount,
  )

  // 4. City tax (municipality levy, not in FareHarbor — applies to all cruise types).
  const cityTaxCents = guestCount * CITY_TAX_PER_GUEST_CENTS

  // 5. Apply promo discount — ALWAYS derived server-side from the promo code id.
  //    The client's displayed discount is never trusted: a forged discountAmountCents
  //    previously let anyone book any cruise for €0.50 (2026-07 security fix). No valid
  //    code → no discount. applyPromoCode already caps the discount to the base.
  const totalBeforeDiscount = extrasCalculation.grand_total_cents + cityTaxCents
  let discountAmountCents = 0
  if (promoCodeId) {
    const validatePromo = deps.validatePromo ?? validatePromoCodeById
    const validation = await validatePromo(promoCodeId, { listingId })
    if (validation.ok) {
      // 'cruise' scope discounts base + city tax only (extras still paid); 'all' → grand total.
      const discountableBase = validation.code.discount_scope === 'cruise'
        ? serverBaseAmount + cityTaxCents
        : undefined
      discountAmountCents = applyPromoCode(validation.code, totalBeforeDiscount, discountableBase).discountAmountCents
    }
  }

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
    customerTypeName,
  }
}
