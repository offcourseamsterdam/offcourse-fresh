import { NextRequest, after } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'
import { analyzeDifference } from '@/lib/ghost/compare'
import { translateToEnglish } from '@/lib/chat/translate'
import { prepareInboxBookingBody } from '@/lib/ghost/book-from-proposal'
import { sendMaintenanceEmail } from '@/lib/maintenance/send-email'
import { sendSms } from '@/lib/sms/send-sms'
import { moveResponseUrl } from '@/lib/ops/move-token'
import { postSlackText } from '@/lib/slack/send-notification'
import { emitOpsEvent } from '@/lib/ops/events'
import { autonomyForKind, levelRank } from '@/lib/ghost/agents'
import { revalidateStoredMove } from '@/lib/ghost/guest-move-drafter'
import { applyScheduleAssignments } from '@/lib/scheduling/apply-assignments'
import { sendConfirmationEmail, type ConfirmationEmailInput } from '@/lib/booking/send-confirmation-email'
import { importFareharborBooking } from '@/lib/fareharbor/import-booking'
import { syncAndScheduleShifts } from '@/lib/scheduling/proactive-scheduling'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { computeCancellationTerms } from '@/lib/ghost/cancellation-terms'
import type { BookingSource } from '@/lib/constants'
import type { BookingProposalInput, AltSlot } from '@/lib/ghost/dry-run'

/**
 * POST /api/admin/ghost/proposals/[id]  { action }
 * One endpoint, actions on a single proposal:
 *   - review:  toggle the reviewed flag (triage)
 *   - redraft: re-run the agent for this conversation (e.g. after teaching it
 *              something) — fires after the response; the new draft appears on
 *              the next poll
 *   - compare: ask Claude what the human changed vs the Ghost's draft, and
 *              store the lesson on the proposal
 *   - book:    the human approves a booking_proposal → re-resolve the slot and
 *              create a REAL booking through the existing money-path endpoint.
 *              This is the only action that touches the outside world, and it
 *              only ever fires on an explicit human click.
 *   - send:    the human approves a maintenance_task → send the drafted
 *              technician quote-request email (Resend). Atomic claim + release,
 *              same shape as `book`; fires only on an explicit human click.
 *   - correct_booking: the human approves a booking_correction → patch the
 *              matched booking's contact field and resend its confirmation
 *              email. Never creates or cancels a booking, only corrects
 *              contact info on an existing one — same atomic-claim shape as
 *              `book`; fires only on an explicit human click.
 *   - import_fh_booking: the human approves a fh_booking_import_ready
 *              proposal → re-fetch the booking live from FareHarbor (it
 *              already exists there, created by a 3rd-party API) and insert
 *              the matching row into our own `bookings` table. Never creates
 *              or charges anything in FareHarbor — same atomic-claim shape as
 *              `book`; fires only on an explicit human click.
 *   - cancel_booking: the human approves a cancellation_request → cancels the
 *              matched booking in FareHarbor and refunds via Stripe, by
 *              calling the existing /api/admin/bookings/[id]/cancel route
 *              (never a second, forked money path). The refund € is
 *              RECOMPUTED here, not read from the payload — see
 *              cancellation-terms.ts. Same atomic-claim shape as `book`;
 *              fires only on an explicit human click.
 *   - mark_rebooked: the human confirms they completed the ACTUAL FareHarbor
 *              rebook after a guest_move_request's guest answered 'accept'
 *              (Beer 2026-08-23 — a guest yes only ever fires a Slack
 *              reminder; nothing closed the loop on whether the human really
 *              did the manual rebook). Records outcome.rebooked_at and
 *              resyncs the affected date(s) so Planning/Scheduling reflect
 *              the real change immediately. Never touches FareHarbor itself
 *              — that rebook already happened by hand; this only confirms it.
 * Everything except `book`, `send`, `correct_booking`, `import_fh_booking`,
 * `cancel_booking` and `mark_rebooked`'s resync is read-only toward the
 * outside world.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { action?: string; reviewed?: boolean; alternative_index?: number }
    const supabase = createAdminClient()

    if (body.action === 'review') {
      const reviewed_at = body.reviewed === false ? null : new Date().toISOString()
      const { error } = await supabase.from('agent_proposals').update({ reviewed_at }).eq('id', id)
      if (error) return apiError(error.message, 500)
      if (reviewed_at) {
        await emitOpsEvent({
          eventType: 'recommendation_reviewed',
          actorType: 'human',
          proposalId: id,
          source: 'admin/ghost/proposals/[id]:review',
        })
      }
      return apiOk({ reviewed_at })
    }

    if (body.action === 'redraft') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('conversation_id, trigger_message_id, kind')
        .eq('id', id)
        .single()
      if (!p?.conversation_id) return apiError('Only conversation proposals can be re-drafted', 400)
      // Re-run the agent off the response path; the fresh proposal polls in.
      after(() => draftShadowReply(p.conversation_id as string, p.trigger_message_id ?? null))
      return apiOk({ queued: true })
    }

    if (body.action === 'compare') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('payload, outcome, trigger:messages!agent_proposals_trigger_message_id_fkey(body)')
        .eq('id', id)
        .single()
      const draft = (p?.payload as { reply?: string } | null)?.reply
      const outcome = (p?.outcome ?? {}) as Record<string, unknown>
      const actual = typeof outcome.human_reply === 'string' ? outcome.human_reply : null
      const customer = (p?.trigger as { body?: string } | null)?.body ?? ''
      if (!draft || !actual) return apiError('Nothing to compare — needs a draft and your actual reply', 400)

      const analysis = await analyzeDifference(customer, draft, actual)
      if (!analysis) return apiError('Could not analyze the difference', 502)

      const nextOutcome = JSON.parse(JSON.stringify({ ...outcome, comparison: analysis }))
      await supabase.from('agent_proposals').update({ outcome: nextOutcome }).eq('id', id)
      return apiOk({ comparison: analysis })
    }

    if (body.action === 'translate') {
      const { data: p } = await supabase.from('agent_proposals').select('payload').eq('id', id).single()
      const payload = (p?.payload ?? {}) as Record<string, unknown>
      const reply = typeof payload.reply === 'string' ? payload.reply : ''
      if (!reply) return apiError('Nothing to translate', 400)
      const tr = await translateToEnglish(reply)
      const reply_en = tr?.translation ?? reply // already English → show as-is
      await supabase
        .from('agent_proposals')
        .update({ payload: JSON.parse(JSON.stringify({ ...payload, reply_en })) })
        .eq('id', id)
      return apiOk({ reply_en })
    }

    if (body.action === 'book') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, status, payload, conversation:conversations(contact:contacts(name, email, phone_e164))')
        .eq('id', id)
        .single()
      if (!p || p.kind !== 'booking_proposal') return apiError('Not a booking proposal', 400)
      if (p.status === 'executed') return apiError('This booking was already created.', 409)

      const proposalBooking = (p.payload as { booking?: BookingProposalInput } | null)?.booking ?? {}
      const contact = (p.conversation as { contact?: { name?: string | null; email?: string | null; phone_e164?: string | null } } | null)?.contact ?? {}

      // If the human picked one of the Ghost's validated alternatives, book THAT
      // instead. We re-derive the booking input from the stored alternative — its
      // pks are hints only; prepareInboxBookingBody + the money path re-resolve and
      // re-validate live, so a client can never inject an arbitrary slot here.
      let bookingInput: BookingProposalInput = proposalBooking
      if (typeof body.alternative_index === 'number') {
        const alts = (p.payload as { verdict?: { alternatives?: AltSlot[] } } | null)?.verdict?.alternatives ?? []
        const alt = alts[body.alternative_index]
        if (!alt) return apiError('That alternative is no longer available — re-check the proposal.', 422)
        bookingInput = { listing_slug: alt.listing_slug, date: alt.date, time: alt.time, guests: alt.guests, option: alt.option }
      }

      const prep = await prepareInboxBookingBody(bookingInput, contact)
      if (!prep.ok) return apiError(prep.error, 422)

      // ATOMIC CLAIM before any real booking: flip 'shadow'→'booking' only if it's
      // still 'shadow'. A second click/concurrent request gets zero rows back and
      // aborts — closing the double-booking window without a schema change. The
      // claim happens BEFORE the FareHarbor create, so two requests can never both
      // reach it. (A durable bookings.idempotency_key is a later phase.)
      const { data: claimed } = await supabase
        .from('agent_proposals')
        .update({ status: 'booking' })
        .eq('id', id)
        .eq('status', 'shadow')
        .select('id')
      if (!claimed?.length) return apiError('This booking is already being created (or was created).', 409)

      try {
        // Reuse the money path verbatim — it runs the FareHarbor validate→create
        // two-step, saves to Supabase, sends Slack + confirmation email. We never
        // fork booking logic. Forward the admin cookie so its requireAdmin passes.
        const bookRes = await fetch(new URL('/api/admin/booking-flow/book', req.nextUrl.origin), {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
          body: JSON.stringify(prep.body),
        })
        const bookJson = (await bookRes.json().catch(() => null)) as { ok?: boolean; error?: string; data?: unknown } | null
        if (!bookRes.ok || !bookJson?.ok) {
          // Release the claim so the human can retry after fixing the cause.
          await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
          return apiError(bookJson?.error ?? 'FareHarbor did not accept the booking', 502)
        }

        // Close the loop: mark executed (the claim already locked out duplicates).
        await supabase
          .from('agent_proposals')
          .update({ status: 'executed', outcome: JSON.parse(JSON.stringify({ booked_at: new Date().toISOString(), booking: bookJson.data })) })
          .eq('id', id)

        await emitOpsEvent({
          eventType: 'recommendation_approved',
          actorType: 'human',
          proposalId: id,
          source: 'admin/ghost/proposals/[id]:book',
        })

        return apiOk({ booking: bookJson.data })
      } catch (bookErr) {
        await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
        throw bookErr
      }
    }

    if (body.action === 'correct_booking') {
      // Runtime autonomy guard, same shape as apply_schedule: refuse when the
      // kind hasn't been granted the 'ask' level.
      if (levelRank(autonomyForKind('booking_correction')) < levelRank('ask')) {
        return apiError('booking_correction is not at the ask level', 403)
      }

      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, status, payload')
        .eq('id', id)
        .single()
      if (!p || p.kind !== 'booking_correction') return apiError('Not a booking correction', 400)
      if (p.status === 'executed') return apiError('This correction was already applied.', 409)

      const correction = (p.payload as { correction?: { booking_id?: string; field?: string; new_value?: string } } | null)
        ?.correction
      if (!correction?.booking_id || correction.field !== 'customer_email' || !correction.new_value) {
        return apiError('This proposal has no valid correction to apply.', 422)
      }
      const newEmail = correction.new_value.trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return apiError('The corrected email address looks invalid.', 422)
      }

      // Validate the target booking BEFORE claiming — same ordering as `book`
      // above: all validation runs first (pure reads, safe to repeat on a
      // concurrent request), and the atomic claim only guards the actual side
      // effect that follows, so there's no claim to manually release on a
      // validation failure.
      const { data: booking } = await supabase
        .from('bookings')
        .select(`
          id, booking_uuid, customer_name, customer_email, customer_phone,
          listing_title, booking_date, start_time, end_time, guest_count,
          category, extras_selected, stripe_amount, fareharbor_customer_type_rate_pk,
          stripe_payment_intent_id, base_amount_cents, discount_amount_cents, status
        `)
        .eq('id', correction.booking_id)
        .single()
      if (!booking) return apiError('The matched booking no longer exists.', 404)
      if (booking.status === 'cancelled') return apiError('This booking was cancelled — the correction was not applied.', 409)

      // ATOMIC CLAIM before touching the booking: 'shadow' → 'booking'
      // (transient), same double-click guard as `book`/`apply_schedule`.
      const { data: claimed } = await supabase
        .from('agent_proposals')
        .update({ status: 'booking' })
        .eq('id', id)
        .eq('status', 'shadow')
        .select('id')
      if (!claimed?.length) return apiError('This correction is already being applied (or was applied).', 409)

      try {
        const { error: updateErr } = await supabase
          .from('bookings')
          .update({ customer_email: newEmail })
          .eq('id', booking.id)
        if (updateErr) throw new Error(`Could not update booking ${booking.id}: ${updateErr.message}`)

        // sendConfirmationEmail never throws (its own best-effort contract for
        // the money-path callers that fire it via Promise.allSettled) — it
        // returns whether the send actually succeeded instead. Here, on an
        // explicit admin click to resend, a false must be treated as a real
        // failure: falling through to 'executed' would tell the admin the
        // customer was notified of their corrected email when they weren't.
        const emailSent = await sendConfirmationEmail({
          contact: { name: booking.customer_name ?? '', email: newEmail, phone: booking.customer_phone ?? undefined },
          listingTitle: booking.listing_title ?? '',
          date: booking.booking_date ?? '',
          startAt: booking.start_time,
          endAt: booking.end_time,
          guestCount: booking.guest_count ?? 1,
          amountCents: booking.stripe_amount ?? 0,
          extrasSelected: (booking.extras_selected ?? []) as ConfirmationEmailInput['extrasSelected'],
          fhBookingUuid: booking.booking_uuid ?? undefined,
          category: booking.category,
          fareharborCustomerTypeRatePk: booking.fareharbor_customer_type_rate_pk,
          stripePaymentIntentId: booking.stripe_payment_intent_id,
          baseAmountCents: booking.base_amount_cents,
          discountAmountCents: booking.discount_amount_cents,
        })
        if (!emailSent) throw new Error('The confirmation email failed to send — the correction was not marked as applied.')

        await supabase
          .from('agent_proposals')
          .update({
            status: 'executed',
            outcome: JSON.parse(JSON.stringify({ corrected_at: new Date().toISOString(), booking_id: booking.id, new_email: newEmail })),
          })
          .eq('id', id)

        await emitOpsEvent({
          eventType: 'recommendation_approved',
          actorType: 'human',
          proposalId: id,
          source: 'admin/ghost/proposals/[id]:correct_booking',
          payload: { booking_id: booking.id },
        })

        return apiOk({ booking_id: booking.id, new_email: newEmail })
      } catch (correctErr) {
        await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
        throw correctErr
      }
    }

    if (body.action === 'import_fh_booking') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, status, payload, conversation_id')
        .eq('id', id)
        .single()
      if (!p || p.kind !== 'fh_booking_import_ready') return apiError('Not a FareHarbor import proposal', 400)
      if (p.status === 'executed') return apiError('This booking was already imported.', 409)

      const payload =
        (p.payload as {
          platform?: string
          bookingRef?: string
          guestName?: string | null
          guestEmail?: string | null
          guestPhone?: string | null
          endTime?: string | null
          parsed?: { dateISO?: string | null; time?: string | null; guests?: number | null; experienceName?: string | null }
        } | null) ?? {}
      const pk = payload.bookingRef ? parseInt(payload.bookingRef, 10) : NaN
      if (!Number.isFinite(pk)) return apiError('This proposal has no valid FareHarbor booking number.', 422)

      // ATOMIC CLAIM before touching Supabase: 'shadow' → 'booking' (transient),
      // same double-click guard as `book`/`correct_booking`.
      const { data: claimed } = await supabase
        .from('agent_proposals')
        .update({ status: 'booking' })
        .eq('id', id)
        .eq('status', 'shadow')
        .select('id')
      if (!claimed?.length) return apiError('This booking is already being imported (or was imported).', 409)

      try {
        const result = await importFareharborBooking(supabase, {
          bookingPk: pk,
          bookingSource: (payload.platform as BookingSource) ?? 'website',
          guestName: payload.guestName ?? null,
          guestEmail: payload.guestEmail ?? null,
          guestPhone: payload.guestPhone ?? null,
          dateISO: payload.parsed?.dateISO ?? null,
          time: payload.parsed?.time ?? null,
          endTime: payload.endTime ?? null,
          guests: payload.parsed?.guests ?? null,
          experienceName: payload.parsed?.experienceName ?? null,
        })
        if (!result.ok) {
          // Release the claim so the human can retry after fixing the cause.
          await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
          return apiError(result.error, 422)
        }

        await supabase
          .from('agent_proposals')
          .update({
            status: 'executed',
            outcome: JSON.parse(JSON.stringify({ imported_at: new Date().toISOString(), booking_id: result.bookingId })),
          })
          .eq('id', id)

        // Flip the conversation itself, not just the proposal — the inbox
        // list label and thread header both read ota_status directly, so
        // without this they'd keep showing "Not in our database" forever
        // even after a successful import (the proposal is a detail only the
        // co-pilot card looks at). ai_summary is refreshed too — otherwise
        // the list's snippet line stays frozen on the pre-import wording
        // ("needs import to system") even though the title above it updates.
        if (p.conversation_id) {
          await supabase
            .from('conversations')
            .update({
              ota_status: 'imported',
              status: 'resolved',
              ai_summary: `Imported — booking #${payload.bookingRef ?? 'unknown'} now in Bookings, Scheduling and Planning.`,
            })
            .eq('id', p.conversation_id)
        }

        // Best-effort: get the newly-imported booking into Scheduling (and try
        // to auto-assign its captain) right away, same fire-and-forget hook
        // every other booking-confirmation path uses (see
        // docs/features/ota-notifications.md).
        after(() => syncAndScheduleShifts(supabase, result.date).catch(err => console.error('[import_fh_booking] shift sync failed:', err)))

        // Every other route that writes a `bookings` row pings this so an
        // already-open Bookings/Planning page refetches immediately instead
        // of showing stale data until the next manual reload — this path was
        // missing it (caught 2026-08-15: importing a booking here didn't
        // make it appear on an already-open Planning page).
        await notifyBookingsChanged()

        await emitOpsEvent({
          eventType: 'recommendation_approved',
          actorType: 'human',
          proposalId: id,
          source: 'admin/ghost/proposals/[id]:import_fh_booking',
          payload: { booking_id: result.bookingId },
        })

        return apiOk({ booking_id: result.bookingId })
      } catch (importErr) {
        await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
        throw importErr
      }
    }

    if (body.action === 'cancel_booking') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, status, payload, conversation_id')
        .eq('id', id)
        .single()
      if (!p || p.kind !== 'cancellation_request') return apiError('Not a cancellation request', 400)
      if (p.status === 'executed') return apiError('This cancellation was already processed.', 409)

      const payload = (p.payload as { cancellation?: { booking_id?: string }; reply?: string } | null) ?? {}
      const bookingId = payload.cancellation?.booking_id
      if (!bookingId) return apiError('This proposal has no booking to cancel.', 422)

      // Recompute fresh — NEVER trust the stored payload's numbers. A proposal
      // drafted yesterday may have crossed a refund-tier boundary overnight;
      // the guest gets today's honest terms, not yesterday's.
      const terms = await computeCancellationTerms(bookingId, supabase)
      if (!terms.bookingFound) return apiError('That booking no longer exists.', 404)
      if (terms.alreadyCancelled) return apiError('This booking is already cancelled.', 409)
      if (terms.isOtaBooking) {
        return apiError(`This booking was made through ${terms.bookingSource} — cancel it there; it will sync back here.`, 409)
      }
      if (!terms.canCancelInFareharbor) {
        return apiError('This booking has no FareHarbor reference we can cancel with — handle it directly in FareHarbor.', 409)
      }

      // Two buttons on the card: the policy-suggested refund, or an explicit
      // no-refund override for the goodwill exceptions policy can't know about.
      // 'suggested' is the default so a bare click does the right thing.
      const { refundOption } = body as { refundOption?: 'suggested' | 'none' }
      const refundCents = refundOption === 'none' ? 0 : terms.refundCents

      // ATOMIC CLAIM before any real action — same double-click guard as `book`.
      const { data: claimed } = await supabase
        .from('agent_proposals')
        .update({ status: 'booking' })
        .eq('id', id)
        .eq('status', 'shadow')
        .select('id')
      if (!claimed?.length) return apiError('This cancellation is already being processed (or was processed).', 409)

      try {
        // Reuse the existing, already-guarded cancel route verbatim — never a
        // second, forked money path. It cancels in FareHarbor and issues the
        // Stripe refund. 'partial' (not 'full') even at 100%: 'full' refunds
        // the ENTIRE stripe_amount regardless of tier, which is only correct
        // at the 100% tier — 'partial' with the exact computed € is correct
        // at every tier, including 0% (below, we just skip the call entirely).
        const cancelBody =
          refundCents > 0
            ? { refundOption: 'partial' as const, partialAmountCents: refundCents }
            : { refundOption: 'none' as const }
        const cancelRes = await fetch(new URL(`/api/admin/bookings/${bookingId}/cancel`, req.nextUrl.origin), {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
          body: JSON.stringify(cancelBody),
        })
        const cancelJson = (await cancelRes.json().catch(() => null)) as
          | { ok?: boolean; error?: string; data?: { cancelled?: boolean; refundError?: string | null } }
          | null
        if (!cancelRes.ok || !cancelJson?.data?.cancelled) {
          // Release the claim so the human can retry after fixing the cause.
          // NOTE: apiOk() nests the payload under `data` — read cancelJson.data.cancelled,
          // never cancelJson.cancelled (that field never existed on a real response and
          // made this branch fire on every success, silently reverting completed
          // cancellations to "pending" while the booking stayed cancelled for real).
          await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
          return apiError(cancelJson?.error ?? 'Could not cancel the booking', 502)
        }

        await supabase
          .from('agent_proposals')
          .update({
            status: 'executed',
            outcome: JSON.parse(
              JSON.stringify({
                cancelled_at: new Date().toISOString(),
                booking_id: bookingId,
                refund_cents: refundCents,
                refund_error: cancelJson.data.refundError ?? null,
              }),
            ),
          })
          .eq('id', id)

        await notifyBookingsChanged()

        // The freed slot may drop a shift's only departure, or shrink a merged
        // one — resync that day rather than waiting for the nightly cron.
        if (terms.departureAt) {
          const date = terms.departureAt.slice(0, 10)
          after(() => syncAndScheduleShifts(supabase, date).catch(err => console.error('[cancel_booking] shift sync failed:', err)))
        }

        await emitOpsEvent({
          eventType: 'recommendation_approved',
          actorType: 'human',
          proposalId: id,
          source: 'admin/ghost/proposals/[id]:cancel_booking',
          payload: { booking_id: bookingId, refund_cents: refundCents },
        })

        return apiOk({ cancelled: true, refund_cents: refundCents })
      } catch (cancelErr) {
        await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
        throw cancelErr
      }
    }

    if (body.action === 'send') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, status, payload')
        .eq('id', id)
        .single()
      // maintenance_task, stock_reorder and catering_upsell are all
      // "draft email → approve → send" (catering_upsell mails the GUEST,
      // via payload.recipient).
      if (!p || (p.kind !== 'maintenance_task' && p.kind !== 'stock_reorder' && p.kind !== 'catering_upsell')) {
        return apiError('Not a sendable email proposal', 400)
      }
      if (p.status === 'executed') return apiError('This email was already sent.', 409)

      const payload = (p.payload ?? {}) as {
        email_subject?: string
        email_body?: string
        recipient?: string
        maintenance_task_id?: string
        item_ids?: string[]
        booking_id?: string
        guest_name?: string | null
      }
      const isStock = p.kind === 'stock_reorder'
      const isUpsell = p.kind === 'catering_upsell'
      // Upsell mails the guest: payload.recipient only, never an env fallback.
      const recipient = isUpsell
        ? payload.recipient
        : payload.recipient ||
          (isStock ? process.env.STOCK_EMAIL_RECIPIENT : process.env.MAINTENANCE_EMAIL_RECIPIENT)
      const subject = payload.email_subject
      const emailBody = payload.email_body
      if (!recipient) {
        if (isUpsell) return apiError('No guest email on this booking.', 422)
        const envVar = isStock ? 'STOCK_EMAIL_RECIPIENT' : 'MAINTENANCE_EMAIL_RECIPIENT'
        return apiError(`No recipient email configured — set ${envVar} or the item's supplier email.`, 400)
      }
      if (!subject || !emailBody) return apiError('This proposal has no drafted email to send.', 422)

      // ATOMIC CLAIM before sending: flip 'shadow'→'sending' only if still
      // 'shadow'. A second click gets zero rows and aborts — no double-send.
      const { data: claimed } = await supabase
        .from('agent_proposals')
        .update({ status: 'sending' })
        .eq('id', id)
        .eq('status', 'shadow')
        .select('id')
      if (!claimed?.length) return apiError('This email is already being sent (or was sent).', 409)

      try {
        const dispatched = await sendMaintenanceEmail({ recipient, subject, body: emailBody })
        if (!dispatched) {
          // No email service configured → nothing actually went out. Release the
          // claim and report it; never mark executed (that would fake success
          // AND permanently block retry via the 'already executed' guard).
          await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
          return apiError('Email not sent — the email service (RESEND_API_KEY) is not configured.', 503)
        }
        await supabase
          .from('agent_proposals')
          .update({
            status: 'executed',
            outcome: JSON.parse(JSON.stringify({ sent_at: new Date().toISOString(), recipient, dispatched })),
          })
          .eq('id', id)
        if (payload.maintenance_task_id) {
          await supabase
            .from('maintenance_tasks')
            .update({ technician_emailed_at: new Date().toISOString() })
            .eq('id', payload.maintenance_task_id)
        }
        // Stock reorder: stamp the ordered items so the board shows "ordered".
        if (isStock && payload.item_ids?.length) {
          await supabase
            .from('stock_items')
            .update({ last_reordered_at: new Date().toISOString() })
            .in('id', payload.item_ids)
        }
        // Upsell: stamp the booking so no other upsell path ever mails this
        // guest again (the extras-upsell cron checks the same column).
        if (isUpsell && payload.booking_id) {
          await supabase
            .from('bookings')
            .update({ extras_upsell_sent_at: new Date().toISOString() })
            .eq('id', payload.booking_id)
        }
        // Best-effort confirmation — a Slack hiccup must never undo a sent email.
        try {
          const label = isUpsell
            ? `🍱 *Snackbox upsell sent* to ${payload.guest_name ?? 'guest'}`
            : isStock
              ? '📦 *Stock reorder email sent*'
              : '🔧 *Maintenance email sent*'
          await postSlackText(`${label} to ${recipient}\n*${subject}*`, {
            type: isUpsell ? 'catering-upsell-sent' : isStock ? 'stock-reorder-sent' : 'maintenance-email-sent',
            triggeredBy: 'admin',
          })
        } catch {
          /* swallow */
        }
        await emitOpsEvent({
          eventType: 'recommendation_approved',
          actorType: 'human',
          proposalId: id,
          source: 'admin/ghost/proposals/[id]:send',
        })
        return apiOk({ dispatched, recipient })
      } catch (sendErr) {
        // Release the claim so the human can retry after fixing the cause.
        await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
        throw sendErr
      }
    }

    if (body.action === 'apply_schedule') {
      // Runtime autonomy guard: applying is the 'ask' rung — refuse when the
      // kind hasn't been granted that level (mirrors the dry-run route).
      if (levelRank(autonomyForKind('schedule_day')) < levelRank('ask')) {
        return apiError('schedule_day is not at the ask level', 403)
      }

      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, status, payload')
        .eq('id', id)
        .single()
      if (!p || p.kind !== 'schedule_day') return apiError('Not a schedule proposal', 400)
      if (p.status === 'executed') return apiError('This schedule was already applied.', 409)

      const payload = (p.payload ?? {}) as {
        target_date?: string
        assignments?: { shift_id?: string; staff_id?: string; staff_name?: string }[]
      }
      const assignments = (payload.assignments ?? []).filter(a => a.shift_id && a.staff_id)
      if (!assignments.length) return apiError('No assignments in this proposal.', 422)

      // ATOMIC CLAIM: 'shadow' → 'booking' (transient), so a double click can
      // never assign twice.
      const { data: claimed } = await supabase
        .from('agent_proposals')
        .update({ status: 'booking' })
        .eq('id', id)
        .eq('status', 'shadow')
        .select('id')
      if (!claimed?.length) return apiError('This schedule is already being applied (or was applied).', 409)

      try {
        const { applied, skipped: skippedShifts } = await applyScheduleAssignments(
          supabase,
          assignments as { shift_id: string; staff_id: string; staff_name?: string }[],
          { actorType: 'human', proposalId: id, source: 'admin/ghost/proposals/[id]:apply_schedule' },
        )

        await supabase
          .from('agent_proposals')
          .update({
            status: 'executed',
            outcome: JSON.parse(
              JSON.stringify({ applied_at: new Date().toISOString(), applied, skipped: skippedShifts }),
            ),
          })
          .eq('id', id)

        await emitOpsEvent({
          eventType: 'recommendation_approved',
          actorType: 'human',
          proposalId: id,
          source: 'admin/ghost/proposals/[id]:apply_schedule',
          payload: { applied: applied.length, skipped: skippedShifts.length },
        })
        try {
          await postSlackText(
            `🗓️ *Ghost schedule applied* for ${payload.target_date}: ${applied.length} captain${applied.length === 1 ? '' : 's'} assigned${skippedShifts.length ? ` · ${skippedShifts.length} skipped (already assigned manually)` : ''}.`,
            { type: 'schedule-applied', triggeredBy: 'admin' },
          )
        } catch {
          /* swallow */
        }
        return apiOk({ applied, skipped: skippedShifts })
      } catch (applyErr) {
        await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
        throw applyErr
      }
    }

    if (body.action === 'send_move') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, status, payload')
        .eq('id', id)
        .single()
      if (!p || p.kind !== 'guest_move_request') return apiError('Not a guest move request', 400)
      if (p.status === 'approved' || p.status === 'executed') return apiError('This request was already sent.', 409)

      const payload = (p.payload ?? {}) as {
        guest_name?: string | null
        guest_email?: string | null
        guest_phone?: string | null
        sms_text?: string
        email_subject?: string
        email_body?: string
        verdict?: { checked_avail_pk?: number | null }
        customer_type_rate_pk?: number
        fh_customer_count?: number
      }
      if (!payload.sms_text || !payload.email_subject || !payload.email_body) {
        return apiError('This proposal has no drafted message to send.', 422)
      }
      if (!payload.guest_email && !payload.guest_phone) {
        return apiError('No guest contact details on this booking.', 422)
      }

      // Execution-chokepoint rule: re-validate the promised slot IMMEDIATELY
      // before contacting the guest. The draft-time verdict may be hours old —
      // if the slot has been taken since, the ask would promise a time we
      // can't deliver. A failed re-check expires the proposal (the nightly
      // run drafts a fresh one if the opportunity still exists).
      if (payload.verdict?.checked_avail_pk) {
        const fresh = await revalidateStoredMove(payload)
        if (!fresh || !fresh.is_bookable) {
          await supabase
            .from('agent_proposals')
            .update({
              status: 'expired',
              payload: JSON.parse(JSON.stringify({ ...(p.payload as Record<string, unknown>), verdict: fresh ?? payload.verdict })),
            })
            .eq('id', id)
          return apiError('The proposed slot is no longer available in FareHarbor — request expired; a fresh one will be drafted if the opportunity still exists.', 409)
        }
      }

      // Personal, unguessable response link (HMAC of the proposal id).
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin
      const link = moveResponseUrl(baseUrl, id)

      // ATOMIC CLAIM before contacting a guest: 'shadow' → 'sending'. A second
      // click gets zero rows and aborts — a guest is never texted twice.
      const { data: claimed } = await supabase
        .from('agent_proposals')
        .update({ status: 'sending' })
        .eq('id', id)
        .eq('status', 'shadow')
        .select('id')
      if (!claimed?.length) return apiError('This request is already being sent (or was sent).', 409)

      try {
        const channels: string[] = []
        let emailError: string | null = null
        let smsError: string | null = null

        if (payload.guest_email) {
          try {
            const sent = await sendMaintenanceEmail({
              recipient: payload.guest_email,
              subject: payload.email_subject,
              body: payload.email_body.replaceAll('{{link}}', link),
            })
            if (sent) channels.push('email')
          } catch (err) {
            emailError = err instanceof Error ? err.message : 'email failed'
          }
        }
        if (payload.guest_phone) {
          try {
            const sent = await sendSms(payload.guest_phone, payload.sms_text.replaceAll('{{link}}', link))
            if (sent) channels.push('sms')
          } catch (err) {
            smsError = err instanceof Error ? err.message : 'sms failed'
          }
        }

        if (!channels.length) {
          // Nothing actually reached the guest — release the claim, report why.
          await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
          const detail = [emailError, smsError].filter(Boolean).join(' · ')
          return apiError(
            detail || 'No channel configured (RESEND_API_KEY / TWILIO_*) — nothing was sent.',
            503,
          )
        }

        // 'approved' = sent, awaiting the guest's answer (the response page
        // flips it to 'executed'). The 48h expiry sweep watches outcome.sent_at.
        await supabase
          .from('agent_proposals')
          .update({
            status: 'approved',
            outcome: JSON.parse(JSON.stringify({
              sent_at: new Date().toISOString(),
              channels,
              ...(emailError ? { email_error: emailError } : {}),
              ...(smsError ? { sms_error: smsError } : {}),
            })),
          })
          .eq('id', id)

        await emitOpsEvent({
          eventType: 'guest_move_requested',
          actorType: 'human',
          proposalId: id,
          source: 'admin/ghost/proposals/[id]:send_move',
          payload: { channels },
        })
        try {
          await postSlackText(
            `📱 *Guest move request sent* to ${payload.guest_name ?? 'guest'} via ${channels.join(' + ')}\nAwaiting their answer — you'll get a ping here when they respond.`,
            { type: 'guest-move-sent', triggeredBy: 'admin' },
          )
        } catch {
          /* swallow */
        }
        return apiOk({ channels })
      } catch (sendErr) {
        await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
        throw sendErr
      }
    }

    if (body.action === 'mark_rebooked') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, payload, outcome')
        .eq('id', id)
        .single()
      if (!p || p.kind !== 'guest_move_request') return apiError('Not a guest move request', 400)

      const outcome = (p.outcome ?? {}) as { guest_response?: string; rebooked_at?: string }
      if (outcome.guest_response !== 'accept') return apiError('The guest has not accepted this move yet.', 409)
      if (outcome.rebooked_at) return apiError('Already marked as rebooked.', 409)

      const payload = (p.payload ?? {}) as {
        target_date?: string
        to_date?: string
        guest_name?: string | null
        cruise_title?: string | null
      }

      const nextOutcome = JSON.parse(JSON.stringify({ ...outcome, rebooked_at: new Date().toISOString() }))
      await supabase.from('agent_proposals').update({ outcome: nextOutcome }).eq('id', id)

      // Resync whichever date(s) actually changed in FareHarbor — the
      // from-day may have lost a departure entirely, the to-day (cross-day
      // moves only) gained one. Fire-and-forget after the response, same as
      // cancel_booking/import_fh_booking's own resyncs — the human's
      // confirmation is what matters here, a resync hiccup shouldn't delay
      // (or undo) it.
      const dates = [...new Set([payload.target_date, payload.to_date].filter((d): d is string => !!d))]
      for (const date of dates) {
        after(() => syncAndScheduleShifts(supabase, date).catch(err => console.error('[mark_rebooked] shift sync failed:', date, err)))
      }

      await notifyBookingsChanged()

      await emitOpsEvent({
        eventType: 'guest_move_rebooked',
        actorType: 'human',
        proposalId: id,
        source: 'admin/ghost/proposals/[id]:mark_rebooked',
      })

      try {
        await postSlackText(
          `✅ *Rebooking confirmed done* for ${payload.guest_name ?? 'guest'} (${payload.cruise_title ?? 'cruise'}) — schedule resynced.`,
          { type: 'guest-move-rebooked', triggeredBy: 'admin' },
        )
      } catch {
        /* swallow */
      }

      return apiOk({ rebooked_at: nextOutcome.rebooked_at })
    }

    return apiError('Unknown action', 400)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Action failed')
  }
}
