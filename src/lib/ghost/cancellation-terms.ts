import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTiers, hoursUntil, getRefundPercent, calculateRefundCents } from '@/lib/cancellation/policy'
import { OTA_BOOKING_SOURCES } from '@/lib/constants'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * What a cancellation would actually mean for one booking — hours until it
 * sails, which refund tier that falls in, and the € that tier applies to what
 * was really paid. Every number here comes from `src/lib/cancellation/policy.ts`
 * (already built, already used on the public cruise page) — this module's only
 * job is resolving the right policy tiers for a BOOKING (rather than a listing
 * page) and turning DB rows into the inputs those pure functions need.
 *
 * Called from three places, deliberately the same function each time rather
 * than three copies that could drift:
 *  1. `check_cancellation_terms` (in-loop tool) — so the drafted reply states
 *     the real refund %, not a guess.
 *  2. Right after `submit_cancellation_request` — stored on the proposal so
 *     the sidebar card shows real numbers.
 *  3. The instant the human clicks Cancel & refund — recomputed fresh, never
 *     trusting the stored payload. A proposal drafted yesterday may have
 *     crossed a tier boundary overnight; the guest gets today's honest answer.
 */
export interface CancellationTerms {
  bookingId: string
  bookingFound: boolean
  guestName: string | null
  listingTitle: string | null
  departureAt: string | null
  hoursUntilDeparture: number | null
  refundPercent: number
  amountPaidCents: number
  refundCents: number
  policySummary: string
  bookingSource: string | null
  isOtaBooking: boolean
  /** Already cancelled — nothing to do. */
  alreadyCancelled: boolean
  /**
   * false ONLY for "exists in FareHarbor but we have no uuid to address it
   * with" — the exact gap the cancel/rebook routes already guard against
   * (2026-08-21). Mirrors that guard's logic so this agent can never propose
   * an action those routes would refuse.
   */
  canCancelInFareharbor: boolean
}

function notFound(bookingId: string): CancellationTerms {
  return {
    bookingId,
    bookingFound: false,
    guestName: null,
    listingTitle: null,
    departureAt: null,
    hoursUntilDeparture: null,
    refundPercent: 0,
    amountPaidCents: 0,
    refundCents: 0,
    policySummary: 'Booking not found.',
    bookingSource: null,
    isOtaBooking: false,
    alreadyCancelled: false,
    canCancelInFareharbor: false,
  }
}

/** "51h before departure → full refund tier (100%)". */
function summarize(hours: number | null, percent: number): string {
  if (hours == null) return 'No departure time on record — cannot place this in the cancellation window.'
  if (hours < 0) return 'Departure has already passed.'
  const roundedHours = Math.round(hours)
  const tierLabel = percent === 100 ? 'full refund tier' : percent === 0 ? 'no-refund tier' : `${percent}% refund tier`
  return `${roundedHours}h before departure → ${tierLabel} (${percent}%)`
}

export async function computeCancellationTerms(
  bookingId: string,
  supabase: AdminClient = createAdminClient(),
  now: Date = new Date(),
): Promise<CancellationTerms> {
  const { data: booking } = await supabase
    .from('bookings')
    .select(
      'id, customer_name, listing_id, listing_title, tour_item_id, start_time, status, booking_source, stripe_amount, booking_uuid, external_id, booking_id',
    )
    .eq('id', bookingId)
    .maybeSingle()
  if (!booking) return notFound(bookingId)

  // Resolve the cancellation tiers that apply to THIS booking. A real website
  // booking carries listing_id (→ cruise_listings.fareharbor_item_pk); an
  // OTA/webhook-imported row instead carries tour_item_id directly. Either
  // resolves to the same fareharbor_items.cancellation_tiers. Falls back to
  // normalizeTiers(null) (= DEFAULT_TIERS) when neither is set, exactly like
  // every other cancellation_tiers reader in this codebase.
  let rawTiers: unknown = null
  if (booking.listing_id) {
    const { data: listing } = await supabase
      .from('cruise_listings')
      .select('fareharbor_item_pk')
      .eq('id', booking.listing_id)
      .maybeSingle()
    if (listing?.fareharbor_item_pk) {
      const { data: item } = await supabase
        .from('fareharbor_items')
        .select('cancellation_tiers')
        .eq('fareharbor_pk', listing.fareharbor_item_pk)
        .maybeSingle()
      rawTiers = item?.cancellation_tiers ?? null
    }
  } else if (booking.tour_item_id) {
    const { data: item } = await supabase
      .from('fareharbor_items')
      .select('cancellation_tiers')
      .eq('fareharbor_pk', Number(booking.tour_item_id))
      .maybeSingle()
    rawTiers = item?.cancellation_tiers ?? null
  }
  const tiers = normalizeTiers(rawTiers)

  const departure = booking.start_time ? new Date(booking.start_time) : null
  const hours = departure ? hoursUntil(departure, now) : null
  const refundPercent = departure ? getRefundPercent(departure, tiers, now) : 0
  const amountPaidCents = booking.stripe_amount ?? 0
  const refundCents = departure ? calculateRefundCents(departure, tiers, amountPaidCents, now) : 0

  const isOtaBooking = !!booking.booking_source && (OTA_BOOKING_SOURCES as readonly string[]).includes(booking.booking_source)
  // Same test the cancel/rebook routes already guard on: a numeric FareHarbor
  // reference exists (external_id, or booking_id in the "fh_{pk}" shape from
  // an OTA import) but we never got a real uuid for it.
  const existsInFareharbor = !!booking.external_id || !!booking.booking_id?.startsWith('fh_')
  const alreadyCancelled = booking.status === 'cancelled'

  return {
    bookingId: booking.id,
    bookingFound: true,
    guestName: booking.customer_name,
    listingTitle: booking.listing_title,
    departureAt: booking.start_time,
    hoursUntilDeparture: hours,
    refundPercent,
    amountPaidCents,
    refundCents,
    policySummary: summarize(hours, refundPercent),
    bookingSource: booking.booking_source,
    isOtaBooking,
    alreadyCancelled,
    canCancelInFareharbor: alreadyCancelled || !!booking.booking_uuid || !existsInFareharbor,
  }
}

/**
 * Compute the terms for a just-submitted cancellation_request and store them
 * on payload.cancellation_terms — same "check_booking in-loop, verdict stored
 * after" shape as dryRunBookingProposal, so the sidebar card shows real
 * numbers without the human having to click anything first. Best-effort:
 * never throws, never blocks the shadow write it follows.
 */
export async function storeCancellationTerms(
  proposalId: string,
  bookingId: string,
  now: Date = new Date(),
): Promise<CancellationTerms | null> {
  try {
    const supabase = createAdminClient()
    const terms = await computeCancellationTerms(bookingId, supabase, now)

    const { data: proposal } = await supabase.from('agent_proposals').select('payload').eq('id', proposalId).single()
    if (!proposal) return terms
    const payload = (proposal.payload ?? {}) as Record<string, unknown>
    const nextPayload = JSON.parse(JSON.stringify({ ...payload, cancellation_terms: terms }))
    await supabase.from('agent_proposals').update({ payload: nextPayload }).eq('id', proposalId)
    return terms
  } catch (err) {
    console.error('[ghost/cancellation-terms] storeCancellationTerms failed:', err instanceof Error ? err.message : err)
    return null
  }
}
