import { CLAUDE_DRAFTER_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitOpsEvent } from '@/lib/ops/events'
import { formatAmsterdamTime } from '@/lib/utils'
import { extractJson } from './ops-drafters'
import { CROSS_DAY_INCENTIVE, CROSS_DAY_MOVE_PROMPT } from './rulebook'
import type { CrossDayConsolidationCandidate } from './cross-day-consolidation'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Drafts + inserts the cross-day consolidation ask as a `guest_move_request`
 * proposal — the SAME kind the same-day gap-closing ask already uses, on
 * purpose: `/api/admin/ghost/proposals/[id]` (the `send_move` action) and
 * `/api/move/respond` are both already generic over payload contents, so
 * reusing the kind means zero new send/response/approval code. See
 * docs/plans/2026-08-23-cross-day-consolidation-optimizer.md.
 *
 * Unlike the same-day drafter (guest-move-drafter.ts), this never dry-run-
 * validates a FareHarbor slot before drafting — the receiving departure is a
 * REAL, already-booked slot (another party is already on it), not a
 * geometric ideal that might not exist as a bookable FareHarbor time. There
 * is nothing to snap to; `findCrossDayConsolidationCandidates` already only
 * proposes pairs where the combined guest count fits the boat's capacity.
 */
export async function draftCrossDayConsolidation(
  supabase: AdminClient,
  candidate: CrossDayConsolidationCandidate,
  opts: { source: string },
): Promise<'drafted' | 'skipped'> {
  try {
    if (!candidate.booking.customerEmail && !candidate.booking.customerPhone) return 'skipped'

    const currentTime = formatAmsterdamTime(candidate.booking.startTime)
    const proposedTime = formatAmsterdamTime(candidate.receivingBooking.startTime)
    const totalEur = ((candidate.booking.totalCents ?? 0) / 100).toFixed(2)

    const response = await meteredMessage('ghost_cross_day_move', {
      model: CLAUDE_DRAFTER_MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `${CROSS_DAY_MOVE_PROMPT}

THE ASK
- Guest: ${candidate.booking.customerName ?? 'guest'} · ${candidate.booking.guestCount ?? '?'} people · ${candidate.booking.listingTitle ?? 'cruise'}
- Current date: ${candidate.fromDate} at ${currentTime} · proposed date: ${candidate.toDate} at ${proposedTime} (same boat: ${candidate.boat}, same time of day, same price: €${totalEur})

Return JSON only:
{"sms_text": "<SMS incl {{link}}>", "email_subject": "<subject>", "email_body": "<plain-text email incl {{link}}, with a one-line summary of their booking (${candidate.fromDate} ${currentTime} → ${candidate.toDate} ${proposedTime}, party size, price unchanged €${totalEur})>"}`,
        },
      ],
    })

    const parsed = extractJson(firstText(response))
    const smsText = typeof parsed?.sms_text === 'string' ? parsed.sms_text : null
    const emailSubject = typeof parsed?.email_subject === 'string' ? parsed.email_subject : null
    const emailBody = typeof parsed?.email_body === 'string' ? parsed.email_body : null
    if (!smsText || !emailSubject || !emailBody) return 'skipped'
    if (!smsText.includes('{{link}}') || !emailBody.includes('{{link}}')) return 'skipped'

    const { data: inserted, error: insertError } = await supabase
      .from('agent_proposals')
      .insert({
        // Reuses the same-day ask's kind on purpose — see the file doc comment.
        kind: 'guest_move_request',
        payload: JSON.parse(
          JSON.stringify({
            target_date: candidate.fromDate,
            booking_id: candidate.booking.id,
            shift_id: candidate.fromShiftId,
            guest_name: candidate.booking.customerName,
            guest_email: candidate.booking.customerEmail,
            guest_phone: candidate.booking.customerPhone,
            cruise_title: candidate.booking.listingTitle,
            guest_count: candidate.booking.guestCount,
            boat: candidate.boat,
            current_start_at: candidate.booking.startTime,
            proposed_start_at: candidate.receivingBooking.startTime,
            proposed_end_at: candidate.receivingBooking.endTime,
            est_saving_cents: candidate.estSavingCents,
            total_cents: candidate.booking.totalCents,
            incentive: CROSS_DAY_INCENTIVE,
            sms_text: smsText,
            email_subject: emailSubject,
            email_body: emailBody,
            // Distinguishes this from a same-day time-shift ask for anything
            // reading the payload later (the Optimizer panel, analytics) —
            // send_move and /api/move/respond don't need it, they're generic.
            move_type: 'cross_day',
            to_shift_id: candidate.toShiftId,
            to_date: candidate.toDate,
            combined_guest_count: candidate.combinedGuestCount,
            capacity: candidate.capacity,
          }),
        ),
        reasoning: `${candidate.toDate}'s ${candidate.boat} departure (${candidate.receivingBooking.guestCount ?? '?'} guests already booked) has room for ${candidate.booking.guestCount ?? '?'} more — moving ${candidate.fromDate}'s lone booking there frees the whole ${candidate.fromDate} shift, saving ≈€${(candidate.estSavingCents / 100).toFixed(2)}. Same product (${candidate.booking.customerTypeName ?? '?'}), no catering aboard either departure — safe to ask.`,
        status: 'shadow',
        model: CLAUDE_DRAFTER_MODEL,
      })
      .select('id')
      .single()

    if (insertError) throw new Error(`Could not create cross-day guest_move_request proposal: ${insertError.message}`)

    await emitOpsEvent({
      eventType: 'recommendation_created',
      actorType: 'agent',
      actorId: 'operations',
      proposalId: inserted?.id ?? null,
      bookingId: candidate.booking.id,
      shiftId: candidate.fromShiftId,
      source: opts.source,
      payload: { from_date: candidate.fromDate, to_date: candidate.toDate, est_saving_cents: candidate.estSavingCents },
    })

    return 'drafted'
  } catch (err) {
    console.error('[ghost/cross-day-move-drafter] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}
