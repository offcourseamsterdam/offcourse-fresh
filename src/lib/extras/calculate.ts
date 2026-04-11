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
}

export interface ExtraLineItem {
  extra_id: string
  name: string
  category: string
  price_type: PriceType
  price_value: number
  vat_rate: number
  guest_count?: number
  amount_cents: number
  vat_amount_cents: number
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
function extractVat(amountInclVat: number, rate: number): number {
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
 * - per_person_per_hour: price_value × guestCount × (durationMinutes / 60)
 * - All prices are INCLUSIVE of VAT; VAT is back-calculated
 * - Base cruise VAT rate is always 9% (hard-coded)
 */
export function calculateExtras(
  baseAmountCents: number,
  guestCount: number,
  selectedExtras: Extra[],
  durationMinutes: number = 90,
): ExtrasCalculation {
  const BASE_VAT_RATE = 9
  const baseVat = extractVat(baseAmountCents, BASE_VAT_RATE)

  // Informational extras have no price impact — exclude from all calculations
  const priced = selectedExtras.filter(e => e.price_type !== 'informational')

  const lineItems: ExtraLineItem[] = []
  let subtotal = baseAmountCents

  // 1. Per-person extras (city tax) — always first, required ones always included
  for (const extra of priced.filter(e => e.price_type === 'per_person_cents')) {
    const amount = Math.round(extra.price_value * guestCount)
    const vat = extractVat(amount, extra.vat_rate)
    lineItems.push({
      extra_id: extra.id,
      name: extra.name,
      category: extra.category,
      price_type: extra.price_type,
      price_value: extra.price_value,
      vat_rate: extra.vat_rate,
      guest_count: guestCount,
      amount_cents: amount,
      vat_amount_cents: vat,
    })
    subtotal += amount
  }

  // 2. Per-person-per-hour extras (unlimited drinks)
  for (const extra of priced.filter(e => e.price_type === 'per_person_per_hour_cents')) {
    const hours = durationMinutes / 60
    const amount = Math.round(extra.price_value * guestCount * hours)
    const vat = extractVat(amount, extra.vat_rate)
    lineItems.push({
      extra_id: extra.id,
      name: extra.name,
      category: extra.category,
      price_type: extra.price_type,
      price_value: extra.price_value,
      vat_rate: extra.vat_rate,
      guest_count: guestCount,
      amount_cents: amount,
      vat_amount_cents: vat,
    })
    subtotal += amount
  }

  for (const extra of priced.filter(e => e.price_type === 'fixed_cents')) {
    const vat = extractVat(extra.price_value, extra.vat_rate)
    lineItems.push({
      extra_id: extra.id,
      name: extra.name,
      category: extra.category,
      price_type: extra.price_type,
      price_value: extra.price_value,
      vat_rate: extra.vat_rate,
      amount_cents: extra.price_value,
      vat_amount_cents: vat,
    })
    subtotal += extra.price_value
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
