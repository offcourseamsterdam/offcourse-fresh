import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { resolveBookingSlot, type BookingProposalInput } from './dry-run'

/**
 * Turn a Ghost booking_proposal (human-readable: slug/date/time/option) into the
 * exact body /api/admin/booking-flow/book wants (FareHarbor availPk +
 * customerTypeRatePk + contact). Re-resolves against LIVE availability — a slot
 * can vanish between the shadow dry-run and the human's click, so we never trust
 * the stored verdict; we re-derive exact-match-or-abstain here, and the booking
 * endpoint itself re-validates (its own validate→create two-step) before creating.
 *
 * Returns a ready-to-POST body or a human-readable reason it can't proceed.
 * Does NOT create anything — pure resolution + a read-only availability fetch.
 */

export interface InboxBookingContact {
  name?: string | null
  email?: string | null
  phone_e164?: string | null
}

export async function prepareInboxBookingBody(
  booking: BookingProposalInput,
  contact: InboxBookingContact,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  // A real booking needs real contact details — never a placeholder.
  if (!contact.name || !contact.email || !contact.phone_e164) {
    return {
      ok: false,
      error: 'This customer needs a name, email and phone before a booking can be created — add the missing detail to their contact (or ask them in chat) first.',
    }
  }
  if (!booking.listing_slug || !booking.date || !booking.time) {
    return { ok: false, error: 'The proposal is missing a listing, date or time.' }
  }

  const guests = Number(booking.guests ?? 0) || 2
  const results = await fetchSearchResults(booking.date, guests)
  const resolved = resolveBookingSlot(results, booking)
  if ('error' in resolved) return { ok: false, error: `Slot no longer bookable — ${resolved.error}` }

  const result = results.find(r => r.listing.slug === booking.listing_slug)
  const slot = result?.availableSlots.find(s => s.pk === resolved.availPk)
  if (!result || !slot) return { ok: false, error: 'Slot no longer available — re-check the proposal.' }
  const ct = slot.customerTypes.find(c => c.pk === resolved.customerTypeRatePk)

  return {
    ok: true,
    body: {
      availPk: resolved.availPk,
      customerTypeRatePk: resolved.customerTypeRatePk,
      guestCount: guests,
      category: result.listing.category,
      contact: { name: contact.name, email: contact.email, phone: contact.phone_e164 },
      listingId: result.listing.id,
      listingTitle: result.listing.title,
      date: booking.date,
      startAt: slot.startAt,
      endAt: slot.endAt,
      baseAmountCents: ct?.priceCents,
      // Internal source: skips Stripe, requires admin (the inbox is admin-only),
      // consumes real FareHarbor capacity. Payment is handled separately.
      bookingSource: 'complimentary',
      note: 'Created from the inbox Ghost co-pilot',
    },
  }
}
