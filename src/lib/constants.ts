// ── Extras categories ────────────────────────────────────────────────────────

export const CATEGORY_EMOJI: Record<string, string> = {
  food: '🍽️',
  drinks: '🥂',
  protection: '🛡️',
  experience: '✨',
  tax: '🏛️',
  info: 'ℹ️',
}

export const EXTRAS_CATEGORIES = ['food', 'drinks', 'protection', 'experience', 'tax', 'info'] as const
export type ExtrasCategory = (typeof EXTRAS_CATEGORIES)[number]

// ── Extras pricing ──────────────────────────────────────────────────────────

export const PRICE_TYPES = [
  { value: 'fixed_cents', label: 'Fixed price' },
  { value: 'percentage', label: 'Percentage (%)' },
  { value: 'per_person_cents', label: 'Per person' },
  { value: 'per_person_per_hour_cents', label: 'Per person per hour' },
  { value: 'informational', label: 'Info only (no charge)' },
] as const

export const VAT_RATES = [0, 9, 21] as const

/** Format an extra's price for display in admin UI */
export function formatExtraPrice(extra: { price_type: string; price_value: number }): string {
  if (extra.price_type === 'informational') return 'Info only'
  if (extra.price_type === 'percentage') return `${extra.price_value}%`
  if (extra.price_type === 'per_person_cents') return `€${(extra.price_value / 100).toFixed(2)}/person`
  if (extra.price_type === 'per_person_per_hour_cents') return `€${(extra.price_value / 100).toFixed(2)}/person/hour`
  return `€${(extra.price_value / 100).toFixed(2)}`
}

// ── Listing categories ────────────────────────────────────────────────���─────

export const LISTING_CATEGORIES = ['private', 'shared', 'standard', 'special', 'seasonal', 'event'] as const
export type ListingCategory = (typeof LISTING_CATEGORIES)[number]
