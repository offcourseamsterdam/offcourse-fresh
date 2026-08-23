import { CLAUDE_DRAFTER_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitOpsEvent } from '@/lib/ops/events'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { PLACEHOLDER_CONTACT, toVerdict, type DryRunVerdict } from './dry-run'
import { boatKeyFromName } from './guest-move-drafter'
import { extractJson } from './ops-drafters'
import { BOAT_SWAP_PROMPT, moveIncentiveFor, moveContactChannel } from './rulebook'
import { isOptedOut } from './reschedule-opt-outs'
import { formatAmsterdamTime } from '@/lib/utils'
import type { AvailabilitySlot } from '@/types'
import type { MergeCandidate } from './ops-review'
import type { ExtrasLineItem } from '@/lib/catering/filter'

/**
 * Boat-swap drafter — the outreach half of computeDayFacts's mergeCandidates
 * (ops-review.ts): a single-booking shift that fits cleanly onto another
 * in-use boat's day (no overlap, capacity checked). Unlike the same-day
 * gap-closer (guest-move-drafter.ts), the TIME never changes here — only
 * the boat — so the dry-run looks for the SAME start time on the OTHER
 * boat instead of searching a window for a different time. Unlike
 * cross-day-consolidation.ts, this never combines two parties onto one
 * departure — the guest still gets their own exclusive/standalone
 * departure, just on a different boat.
 *
 * Reuses the same-day ask's `guest_move_request` kind (move_type:
 * 'boat_swap') — zero new send/response code, same as the cross-day variant.
 */

type AdminClient = ReturnType<typeof createAdminClient>

export interface BoatSwapBooking {
  id: string
  category: string | null
  customerTypeName: string | null
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  guestCount: number | null
  totalCents: number | null
  fareharborAvailabilityPk: number | null
  extrasSelected: ExtrasLineItem[] | null
  listingId: string | null
  listingTitle: string | null
  startTime: string | null
  endTime: string | null
}

export interface SwapSlot {
  availPk: number
  customerTypeRatePk: number
  optionName: string
}

/**
 * Same start time, different boat. Unlike pickSnapSlot (guest-move-drafter.ts),
 * which searches a WINDOW of times for a gap-closing move, a boat swap
 * changes nothing about WHEN the guest sails — only exact-time slots count.
 */
export function findSwapSlot(
  slots: AvailabilitySlot[],
  input: { startAt: string; durationMinutes: number; toBoatKey: 'diana' | 'curacao'; category: string | null; guests: number },
): SwapSlot | null {
  const target = new Date(input.startAt).getTime()
  const slot = slots.find(s => new Date(s.startAt).getTime() === target)
  if (!slot) return null

  let cts = slot.customerTypes.filter(ct => ct.boatId === input.toBoatKey && ct.durationMinutes === input.durationMinutes)
  // Party fit only for shared (private types list min/max party as 1/1 —
  // you book the boat, not seats; a party filter would wrongly exclude it).
  if (input.category !== 'private') {
    cts = cts.filter(ct => input.guests >= ct.minimumParty && input.guests <= ct.maximumParty)
  }
  if (!cts.length) return null
  const ct = [...cts].sort((a, b) => a.priceCents - b.priceCents)[0]
  return { availPk: slot.pk, customerTypeRatePk: ct.pk, optionName: ct.name }
}

export interface ValidatedSwap {
  slot: SwapSlot
  verdict: DryRunVerdict
}

/**
 * The dry-run: confirm the target boat genuinely has room at the guest's
 * EXACT current time, then have FareHarbor itself validate it (non-mutating)
 * for the whole party. Returns null when there's nothing real to ask about —
 * no ask ever goes out on a guess, same rule as every other move type.
 */
export async function validateBoatSwap(
  candidate: MergeCandidate,
  booking: BoatSwapBooking,
  listingSlug: string,
): Promise<ValidatedSwap | null> {
  const toBoatKey = boatKeyFromName(candidate.toBoat)
  if (!toBoatKey) return null
  if (!booking.startTime || !booking.endTime) return null

  const durationMinutes = Math.round((new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / 60_000)
  const guests = booking.guestCount ?? 2

  const results = await fetchSearchResults(booking.startTime.slice(0, 10), guests)
  const listing = results.find(r => r.listing.slug === listingSlug)
  if (!listing) return null

  const slot = findSwapSlot(listing.availableSlots, {
    startAt: booking.startTime,
    durationMinutes,
    toBoatKey,
    category: booking.category,
    guests,
  })
  if (!slot) return null

  const fh = getFareHarborClient()
  const customerCount = booking.category === 'private' ? 1 : guests
  const validation = await fh.validateBooking(slot.availPk, {
    contact: PLACEHOLDER_CONTACT,
    customers: Array.from({ length: customerCount }, () => ({ customer_type_rate: slot.customerTypeRatePk })),
    note: 'Ghost dry-run capability check — not a real booking',
  })
  const verdict = toVerdict(validation, slot.availPk, new Date().toISOString())
  if (!verdict.is_bookable) return null

  return { slot, verdict }
}

/**
 * Claude drafts the SMS + email, then the shadow proposal is written and
 * logged — same shape as cross-day-move-drafter.ts.
 */
export async function draftBoatSwap(
  supabase: AdminClient,
  candidate: MergeCandidate,
  booking: BoatSwapBooking,
  validated: ValidatedSwap,
  opts: { source: string; listingSlug: string },
): Promise<'drafted' | 'skipped'> {
  try {
    if (!booking.customerEmail && !booking.customerPhone) return 'skipped'
    if (await isOptedOut(supabase, { email: booking.customerEmail, phone: booking.customerPhone })) return 'skipped'

    const time = formatAmsterdamTime(booking.startTime)
    const totalEur = ((booking.totalCents ?? 0) / 100).toFixed(2)
    const incentive = moveIncentiveFor(booking.category, booking.extrasSelected)
    const channel = moveContactChannel(booking.customerPhone)

    const response = await meteredMessage('ghost_boat_swap', {
      model: CLAUDE_DRAFTER_MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `${BOAT_SWAP_PROMPT}

THE ASK
- Guest: ${booking.customerName ?? 'guest'} · ${booking.guestCount ?? '?'} people · ${booking.listingTitle ?? 'cruise'} on ${candidate.date} at ${time}
- Current boat: ${candidate.fromBoat} · proposed boat: ${candidate.toBoat} (same date, same time, same price: €${totalEur})
- Incentive to offer: ${incentive ?? 'NONE — they already have Unlimited Drinks, so no sweetener this time; just make the plain ask'}
- Channel: ${channel.toUpperCase()}

Return JSON only:
${channel === 'sms'
  ? '{"sms_text": "<SMS incl {{link}}>"}'
  : `{"email_subject": "<subject>", "email_body": "<plain-text email incl {{link}}, with a one-line summary of their booking (${candidate.date} ${time}, ${candidate.fromBoat} → ${candidate.toBoat}, party size, price unchanged €${totalEur})>"}`}`,
        },
      ],
    })

    const parsed = extractJson(firstText(response))
    const smsText = typeof parsed?.sms_text === 'string' ? parsed.sms_text : null
    const emailSubject = typeof parsed?.email_subject === 'string' ? parsed.email_subject : null
    const emailBody = typeof parsed?.email_body === 'string' ? parsed.email_body : null
    if (channel === 'sms' ? !smsText : !emailSubject || !emailBody) return 'skipped'
    if (channel === 'sms' ? !smsText!.includes('{{link}}') : !emailBody!.includes('{{link}}')) return 'skipped'

    const { data: inserted, error: insertError } = await supabase
      .from('agent_proposals')
      .insert({
        // Reuses the same-day ask's kind on purpose — see the file doc comment.
        kind: 'guest_move_request',
        payload: JSON.parse(
          JSON.stringify({
            target_date: candidate.date,
            booking_id: booking.id,
            shift_id: candidate.shiftId,
            guest_name: booking.customerName,
            guest_email: booking.customerEmail,
            guest_phone: booking.customerPhone,
            cruise_title: booking.listingTitle,
            guest_count: booking.guestCount,
            boat: candidate.toBoat,
            current_start_at: booking.startTime,
            proposed_start_at: booking.startTime,
            proposed_end_at: booking.endTime,
            est_saving_cents: candidate.estSavingCents ?? 0,
            total_cents: booking.totalCents,
            incentive,
            sms_text: smsText,
            email_subject: emailSubject,
            email_body: emailBody,
            // Dry-run trail: the FH-confirmed slot behind the ask, and what
            // send_move re-validates right before dispatch (same party shape).
            listing_slug: opts.listingSlug,
            customer_type_rate_pk: validated.slot.customerTypeRatePk,
            fh_customer_count: booking.category === 'private' ? 1 : (booking.guestCount ?? 2),
            verdict: validated.verdict,
            // Distinguishes this from a same-day time-shift / cross-day ask
            // for anything reading the payload later — send_move and
            // /api/move/respond don't need it, they're generic.
            move_type: 'boat_swap',
            from_boat: candidate.fromBoat,
            to_boat: candidate.toBoat,
          }),
        ),
        reasoning: `${candidate.fromBoat}'s only departure on ${candidate.date} fits cleanly onto ${candidate.toBoat}'s day (no overlap, within capacity) — moving it frees ${candidate.fromBoat}'s captain entirely, saving ≈€${((candidate.estSavingCents ?? 0) / 100).toFixed(2)}. FareHarbor confirmed the same-time slot on ${candidate.toBoat} is bookable.`,
        status: 'shadow',
        model: CLAUDE_DRAFTER_MODEL,
      })
      .select('id')
      .single()

    if (insertError) throw new Error(`Could not create boat-swap guest_move_request proposal: ${insertError.message}`)

    await emitOpsEvent({
      eventType: 'recommendation_created',
      actorType: 'agent',
      actorId: 'operations',
      proposalId: inserted?.id ?? null,
      bookingId: booking.id,
      shiftId: candidate.shiftId,
      source: opts.source,
      payload: { date: candidate.date, from_boat: candidate.fromBoat, to_boat: candidate.toBoat, est_saving_cents: candidate.estSavingCents ?? 0 },
    })

    return 'drafted'
  } catch (err) {
    console.error('[ghost/boat-swap-drafter] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}
