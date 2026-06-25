// src/lib/extras/calculate.ts

export type PriceType = 'fixed_cents' | 'percentage' | 'per_person_cents' | 'per_person_per_hour_cents' | 'informational'

export interface Extra {
  id: string
  name: string
  category: string
  price_type: PriceType
  price_value: number
  vat_rate: number
  is_required: boolean
  quantity_mode?: string
  min_quantity?: number
  /** When set on a per_person_cents extra: qty represents people-count for this
   *  item (decoupled from booking guestCount). Counter starts at this value;
   *  pricing = qty × price_value. NULL = legacy behaviour (applies to all guests). */
  min_people?: number | null
  /** When true (only meaningful on per-person-pick extras), the booking-flow counter
   *  caps at adult count rather than total guests. Use for items that can't be sold
   *  to children, e.g. Unlimited Drinks. */
  adults_only?: boolean
}

export interface ExtraLineItem {
  extra_id: string
  name: string
  category: string
  price_type: PriceType
  price_value: number
  vat_rate: number
  guest_count?: number
  quantity: number
  amount_cents: number
  vat_amount_cents: number
  /** True when this is a per-person extra where the customer picked the people
   *  count explicitly (price = quantity × price_value, not × booking guestCount). */
  is_per_person_pick?: boolean
}

export interface ExtrasCalculation {
  base_amount_cents: number
  base_vat_rate: number
  base_vat_amount_cents: number
  extras_amount_cents: number
  extras_vat_amount_cents: number
  total_vat_amount_cents: number
  grand_total_cents: number
  line_items: ExtraLineItem[]
}

/** Back-calculate VAT from an inclusive price: vat = price × rate / (100 + rate) */
export function extractVat(amountInclVat: number, rate: number): number {
  if (rate === 0) return 0
  return Math.round(amountInclVat * rate / (100 + rate))
}

/**
 * Calculate all extras for a booking.
 *
 * Key rules:
 * - Informational extras are excluded from all financial calculations
 * - Calculation order: per_person → per_person_per_hour → fixed → percentage (insurance last)
 * - Percentage extras calculate on the subtotal BEFORE themselves (never on themselves)
 * - City tax guestCount is the actual number of guests — NOT the FareHarbor quantity
 *   (private cruises always use quantity=1 for FareHarbor, but city tax uses actual guests)
 * - per_person_per_hour: price_value × headcount × (durationMinutes / 60)
 * - adults_only extras use adultCount as their headcount (a child can't take unlimited
 *   drinks); all other per-person extras use the full guestCount. adultCount defaults to
 *   guestCount, so callers without an adult/child split behave exactly as before.
 * - All prices are INCLUSIVE of VAT; VAT is back-calculated
 * - Base cruise VAT rate is always 9% (hard-coded)
 * - Counter-mode extras: amount is multiplied by quantity
 */
export function calculateExtras(
  baseAmountCents: number,
  guestCount: number,
  selectedExtras: Extra[],
  durationMinutes = 90,
  quantities: Map<string, number> = new Map(),
  adultCount?: number,
): ExtrasCalculation {
  const BASE_VAT_RATE = 9
  const baseVat = extractVat(baseAmountCents, BASE_VAT_RATE)
  // adults_only per-person extras bill by adults; everything else by total guests.
  const adults = adultCount ?? guestCount
  const headcountFor = (extra: Extra) => (extra.adults_only ? adults : guestCount)

  // Informational extras have no price impact — exclude from all calculations
  const priced = selectedExtras.filter(e => e.price_type !== 'informational')

  const lineItems: ExtraLineItem[] = []
  let subtotal = baseAmountCents

  // Get the quantity multiplier for an extra (1 for toggle mode, actual qty for counter mode)
  function getQty(extra: Extra): number {
    if (extra.quantity_mode === 'counter') {
      return quantities.get(extra.id) ?? 1
    }
    return 1
  }

  // 1. Per-person extras (city tax, catering) — always first, required ones always included
  //
  // Two flavours:
  //  - min_people set:   qty = people-count for this item (decoupled from booking guestCount).
  //                      amount = price_value × qty. Counter UI in the booking flow.
  //  - min_people NULL:  legacy "applies to all guests" semantic.
  //                      amount = price_value × guestCount × qty.
  for (const extra of priced.filter(e => e.price_type === 'per_person_cents')) {
    const qty = getQty(extra)
    const isPerPersonPick = extra.min_people != null && extra.min_people > 0
    // Legacy "applies to all guests" items bill by headcount (adults only when adults_only).
    const headcount = headcountFor(extra)
    const amount = isPerPersonPick
      ? extra.price_value * qty
      : Math.round(extra.price_value * headcount) * qty
    const vat = extractVat(amount, extra.vat_rate)
    lineItems.push({
      extra_id: extra.id,
      name: extra.name,
      category: extra.category,
      price_type: extra.price_type,
      price_value: extra.price_value,
      vat_rate: extra.vat_rate,
      guest_count: isPerPersonPick ? qty : headcount,
      quantity: qty,
      amount_cents: amount,
      vat_amount_cents: vat,
      ...(isPerPersonPick ? { is_per_person_pick: true } : {}),
    })
    subtotal += amount
  }

  // 2. Per-person-per-hour extras (unlimited drinks) — adults_only bills adults only
  for (const extra of priced.filter(e => e.price_type === 'per_person_per_hour_cents')) {
    const qty = getQty(extra)
    const hours = durationMinutes / 60
    const headcount = headcountFor(extra)
    const unitAmount = Math.round(extra.price_value * headcount * hours)
    const amount = unitAmount * qty
    const vat = extractVat(amount, extra.vat_rate)
    lineItems.push({
      extra_id: extra.id,
      name: extra.name,
      category: extra.category,
      price_type: extra.price_type,
      price_value: extra.price_value,
      vat_rate: extra.vat_rate,
      guest_count: headcount,
      quantity: qty,
      amount_cents: amount,
      vat_amount_cents: vat,
    })
    subtotal += amount
  }

  // 3. Fixed-price extras
  for (const extra of priced.filter(e => e.price_type === 'fixed_cents')) {
    const qty = getQty(extra)
    const amount = extra.price_value * qty
    const vat = extractVat(amount, extra.vat_rate)
    lineItems.push({
      extra_id: extra.id,
      name: extra.name,
      category: extra.category,
      price_type: extra.price_type,
      price_value: extra.price_value,
      vat_rate: extra.vat_rate,
      quantity: qty,
      amount_cents: amount,
      vat_amount_cents: vat,
    })
    subtotal += amount
  }

  // 4. Percentage extras (insurance) — calculated on subtotal before themselves
  for (const extra of priced.filter(e => e.price_type === 'percentage')) {
    const amount = Math.round(subtotal * extra.price_value / 100)
    const vat = extractVat(amount, extra.vat_rate)
    lineItems.push({
      extra_id: extra.id,
      name: extra.name,
      category: extra.category,
      price_type: extra.price_type,
      price_value: extra.price_value,
      vat_rate: extra.vat_rate,
      quantity: 1,
      amount_cents: amount,
      vat_amount_cents: vat,
    })
    subtotal += amount
  }

  const extrasAmount = subtotal - baseAmountCents
  const extrasVat = lineItems.reduce((sum, li) => sum + li.vat_amount_cents, 0)

  return {
    base_amount_cents: baseAmountCents,
    base_vat_rate: BASE_VAT_RATE,
    base_vat_amount_cents: baseVat,
    extras_amount_cents: extrasAmount,
    extras_vat_amount_cents: extrasVat,
    total_vat_amount_cents: baseVat + extrasVat,
    grand_total_cents: subtotal,
    line_items: lineItems,
  }
}
