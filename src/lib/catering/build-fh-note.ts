import type { ExtrasLineItem } from './filter'

/**
 * Build the text that gets written to the FareHarbor booking note.
 * Combines catering pre-orders with any guest special requests into one field.
 * Returns null when there is nothing to write.
 */
export function buildFHBookingNote(
  guestNote: string | null | undefined,
  cateringItems: ExtrasLineItem[],
): string | null {
  const parts: string[] = []

  if (cateringItems.length > 0) {
    const lines = cateringItems.map(item => {
      const qty = item.is_per_person_pick
        ? `×${item.quantity ?? 1} people`
        : `×${item.quantity ?? 1}`
      return `- ${item.name} ${qty}`
    })
    parts.push(`Catering pre-order:\n${lines.join('\n')}`)
  }

  if (guestNote?.trim()) {
    parts.push(`Guest note: ${guestNote.trim()}`)
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}
