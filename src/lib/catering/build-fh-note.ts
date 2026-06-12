import type { ExtrasLineItem } from './filter'

function euros(cents: number): string {
  return `€${(cents / 100).toFixed(0)}`
}

/**
 * Build the text written to the FareHarbor booking note.
 *
 * Accepts ALL extras_selected items (not pre-filtered). Food and drinks are
 * split internally. Payment status is derived from the `source` field:
 * - source === 'extras_upsell' → settle on day (added post-booking, unpaid)
 * - no source (checkout) → paid at booking via Stripe
 *
 * Format:
 *   Food:
 *   - Fruit Platter ×6 people — €65 (paid)
 *
 *   Drinks: pay per drink bar (on the day)
 *
 *   Paid at booking: €65
 *
 *   Guest note: no nuts please
 *
 * Returns null when there is nothing to write (no catering, no guest note).
 */
export function buildFHBookingNote(
  guestNote: string | null | undefined,
  allExtras: ExtrasLineItem[],
): string | null {
  const food = allExtras.filter(e => e.category === 'food')
  const drinks = allExtras.filter(e => e.category === 'drinks')
  const hasCatering = food.length > 0 || drinks.length > 0
  const hasNote = !!guestNote?.trim()

  if (!hasCatering && !hasNote) return null

  function lineItem(item: ExtrasLineItem): string {
    const qty = item.is_per_person_pick
      ? `×${item.quantity ?? 1} people`
      : `×${item.quantity ?? 1}`
    const amount = item.amount_cents ? ` — ${euros(item.amount_cents)}` : ''
    const status = item.source === 'extras_upsell' ? ' (settle on day)' : ' (paid)'
    return `- ${item.name} ${qty}${amount}${status}`
  }

  const parts: string[] = []

  // Food section
  if (food.length > 0) {
    parts.push(`Food:\n${food.map(lineItem).join('\n')}`)
  } else {
    parts.push('Food: nothing pre-ordered')
  }

  // Drinks section
  if (drinks.length > 0) {
    parts.push(`Drinks:\n${drinks.map(lineItem).join('\n')}`)
  } else {
    parts.push('Drinks: pay per drink bar (on the day)')
  }

  // Totals (catering items only)
  const catering = [...food, ...drinks]
  const paidCents = catering
    .filter(e => e.source !== 'extras_upsell')
    .reduce((sum, e) => sum + (e.amount_cents ?? 0), 0)
  const settleCents = catering
    .filter(e => e.source === 'extras_upsell')
    .reduce((sum, e) => sum + (e.amount_cents ?? 0), 0)

  const totals: string[] = []
  if (paidCents > 0) totals.push(`Paid at booking: ${euros(paidCents)}`)
  if (settleCents > 0) totals.push(`Settle on day: ${euros(settleCents)}`)
  if (totals.length > 0) parts.push(totals.join('\n'))

  // Guest note
  if (hasNote) {
    parts.push(`Guest note: ${guestNote!.trim()}`)
  }

  return parts.join('\n\n')
}
