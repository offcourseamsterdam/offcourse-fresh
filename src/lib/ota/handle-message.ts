import { checkOtaAvailability } from './check-availability'
import { pickCheapestPrivateOption, type AvailabilityListing } from './availability-shape'
import { OTA_PLATFORM_NAME, type OtaDetection } from './detect'
import { postSlackCritical } from '@/lib/slack/send-notification'
import type { Json } from '@/lib/supabase/types'

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>

/**
 * `bookable` is returned as its own boolean (not just baked into the prose
 * summary) so the inbox list can render a real checkmark/cross icon driven
 * by this actual tool result, rather than trusting the AI summary's wording.
 * The bookable/cheapest computation itself lives in availability-shape.ts —
 * the ContextPane card re-derives the identical result from the same raw
 * `availability` payload, so there's exactly one place that defines it.
 */
function privateAvailability(
  availability: Awaited<ReturnType<typeof checkOtaAvailability>>,
): { bookable: boolean | null; summary: string; cheapest?: { name: string; price_eur: number } } {
  if (!availability.checked) {
    return { bookable: null, summary: `availability could not be checked (${availability.reason ?? 'unclear date/guests'})` }
  }
  const data = availability.availability as { listings?: AvailabilityListing[] } | undefined
  const { bookable, cheapest } = pickCheapestPrivateOption(data?.listings)
  return bookable && cheapest
    ? { bookable: true, summary: `✓ bookable (${cheapest.name}, from €${cheapest.price_eur})`, cheapest }
    : { bookable: false, summary: '✗ not available as a private cruise at this time — check manually' }
}

/**
 * The proposal is the whole point of handling an OTA message — it's the only
 * thing that puts an actionable card in front of staff. Swallowing an insert
 * error here would leave the conversation's ota_status already flipped with
 * no card ever appearing, looking handled when the request (or a guest's paid
 * booking) was actually dropped. Throws so the caller's existing "never break
 * the batch, just log" guard around this call (gmail/sync.ts) catches and
 * surfaces it instead.
 */
async function insertOtaProposal(
  supabase: SupabaseAdmin,
  proposal: {
    kind: 'ota_availability' | 'ota_booking_ready' | 'fh_booking_import_ready'
    conversation_id: string
    trigger_message_id: string | null
    payload: Json
    reasoning: string
    status: 'shadow'
  },
): Promise<void> {
  const { error } = await supabase.from('agent_proposals').insert(proposal)
  if (error) throw new Error(`Could not create ${proposal.kind} proposal: ${error.message}`)
}

/**
 * What Ghost does with an OTA notification email — deliberately NOT the
 * reply-drafting pipeline (draftShadowReply). Nobody emails Withlocals or
 * GetMyBoat back; you act on their own platform. So there's no "reply you'd
 * send" to produce here, just facts for the team to act on: a live
 * availability check for a new request, or a review-and-book prompt once the
 * platform confirms the guest paid. See docs/features/ota-notifications.md.
 *
 * Returns a short plain-English description of what was found/done — fed
 * into the inbox's AI summary (see gmail/summarize.ts) alongside the raw
 * email, so the list snippet says "bookable, Diana 2h available" instead of
 * just repeating marketing boilerplate. Null for an unrecognized shape
 * (kind === 'other'), where nothing was done.
 */
export async function handleOtaMessage(
  supabase: SupabaseAdmin,
  ota: OtaDetection,
  conversationId: string,
  triggerMessageId: string | null,
): Promise<string | null> {
  if (ota.kind === 'new_request') {
    const availability = await checkOtaAvailability(ota)
    const { bookable, summary, cheapest } = privateAvailability(availability)
    await supabase.from('conversations').update({ ota_status: 'waiting', ota_available: bookable }).eq('id', conversationId)
    await insertOtaProposal(supabase, {
      kind: 'ota_availability',
      conversation_id: conversationId,
      trigger_message_id: triggerMessageId,
      payload: JSON.parse(
        JSON.stringify({
          platform: ota.platform,
          bookingRef: ota.bookingRef,
          guestName: ota.guestName,
          requested: ota.parsed,
          bookable,
          cheapestOption: cheapest,
          ...availability,
        }),
      ),
      reasoning: `New ${ota.platform} booking request — checked live availability for the requested date and guest count.`,
      status: 'shadow',
    })
    return `New ${ota.platform} booking request, ref ${ota.bookingRef ?? 'unknown'} — ${ota.parsed.date ?? 'date unclear'}${ota.parsed.time ? ` at ${ota.parsed.time}` : ''}, ${ota.parsed.guests ?? '?'} guests, private cruise. Availability: ${summary}.`
  }

  if (ota.kind === 'confirmed') {
    await supabase.from('conversations').update({ ota_status: 'confirmed' }).eq('id', conversationId)
    await insertOtaProposal(supabase, {
      kind: 'ota_booking_ready',
      conversation_id: conversationId,
      trigger_message_id: triggerMessageId,
      payload: JSON.parse(
        JSON.stringify({
          platform: ota.platform,
          bookingRef: ota.bookingRef,
          guestName: ota.guestName,
          parsed: ota.parsed,
        }),
      ),
      reasoning: `${ota.platform} booking confirmed (ref ${ota.bookingRef ?? 'unknown'}) — the guest already paid on the platform; review and create the booking.`,
      status: 'shadow',
    })
    return `${ota.platform} booking CONFIRMED, ref ${ota.bookingRef ?? 'unknown'} — ${ota.parsed.date ?? 'date unclear'}${ota.parsed.time ? ` at ${ota.parsed.time}` : ''}, ${ota.parsed.guests ?? '?'} guests, private cruise. Guest already paid on the platform — ready for the team to create the booking.`
  }

  if (ota.kind === 'needs_import') {
    await supabase.from('conversations').update({ ota_status: 'needs_import' }).eq('id', conversationId)
    await insertOtaProposal(supabase, {
      kind: 'fh_booking_import_ready',
      conversation_id: conversationId,
      trigger_message_id: triggerMessageId,
      payload: JSON.parse(
        JSON.stringify({
          platform: ota.platform,
          bookingRef: ota.bookingRef,
          guestName: ota.guestName,
          guestEmail: ota.guestEmail,
          guestPhone: ota.guestPhone,
          endTime: ota.endTime,
          parsed: ota.parsed,
        }),
      ),
      reasoning: `${OTA_PLATFORM_NAME[ota.platform]} created booking #${ota.bookingRef ?? 'unknown'} directly in FareHarbor — it's real and already there, just not synced into our own database yet.`,
      status: 'shadow',
    })
    return `New ${OTA_PLATFORM_NAME[ota.platform]} booking already in FareHarbor (#${ota.bookingRef ?? 'unknown'}) — ${ota.parsed.date ?? 'date unclear'}${ota.parsed.time ? ` at ${ota.parsed.time}` : ''}, ${ota.parsed.guests ?? '?'} guests, ${ota.parsed.experienceName ?? 'cruise'}. Not yet in our own database — import it so it shows in Bookings, Scheduling and Planning.`
  }

  if (ota.kind === 'own_channel') {
    // This notification is FareHarbor echoing back a booking OUR OWN website
    // just created (see detect.ts's platformFromAffiliate) — check our own
    // `bookings` table rather than offering an import, since importing would
    // create a real duplicate of a row that's normally already there. The
    // Stripe PaymentIntent id (Boat Local's "Voucher" field) is an exact,
    // unique match; email+date is the fallback when it's missing.
    let matched: { id: string } | null = null
    if (ota.stripePaymentIntentId) {
      const { data } = await supabase
        .from('bookings')
        .select('id')
        .eq('stripe_payment_intent_id', ota.stripePaymentIntentId)
        .maybeSingle()
      matched = data
    }
    if (!matched && ota.guestEmail && ota.parsed.dateISO) {
      const { data } = await supabase
        .from('bookings')
        .select('id')
        .eq('customer_email', ota.guestEmail)
        .eq('booking_date', ota.parsed.dateISO)
        .maybeSingle()
      matched = data
    }

    if (matched) {
      await supabase.from('conversations').update({ status: 'resolved' }).eq('id', conversationId)
      return `${OTA_PLATFORM_NAME[ota.platform]} booking notification (#${ota.bookingRef ?? 'unknown'}) — already in our database, this is FareHarbor echoing back our own website's booking. No action needed.`
    }

    // Genuinely unexpected: our own website's FareHarbor create apparently
    // succeeded (FareHarbor sent this notification), but no matching row
    // exists in our database — the same "paid but unbooked"-shaped gap the
    // Stripe webhook alerts on, just discovered from the other direction.
    // There's no rich-enough data here (no extras/campaign/discount) to
    // safely reconstruct the row automatically, so this needs a human to
    // check FareHarbor and Stripe directly rather than a one-click fix.
    await supabase
      .from('conversations')
      .update({ ota_source: ota.platform, ota_status: 'sync_mismatch', ota_guest_name: ota.guestName })
      .eq('id', conversationId)
    await postSlackCritical(
      `🔴 *Website booking notification with no matching database row*\n` +
        `FareHarbor confirms booking #${ota.bookingRef ?? 'unknown'} (${ota.parsed.experienceName ?? 'cruise'}, ${ota.parsed.date ?? '?'}${ota.parsed.time ? ` at ${ota.parsed.time}` : ''}) was created via our own website integration, but no matching row exists in our \`bookings\` table.\n` +
        `*Guest:* ${ota.guestName ?? '?'} · ${ota.guestEmail ?? '?'}\n` +
        `_Check FareHarbor and Stripe directly — this may be a Supabase write that silently failed._`,
    )
    return `Website booking notification (#${ota.bookingRef ?? 'unknown'}) — no matching row in our database. Alerted for a manual check.`
  }

  // kind === 'other' — recognized platform, unrecognized message shape. Leave
  // it as a plain, un-drafted conversation; a human sees it with no Ghost
  // block and can handle it manually.
  return null
}
