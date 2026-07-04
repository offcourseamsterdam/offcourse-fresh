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
 * Everything except `book` and `send` is read-only toward the outside world.
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

    if (body.action === 'send') {
      const { data: p } = await supabase
        .from('agent_proposals')
        .select('id, kind, status, payload')
        .eq('id', id)
        .single()
      // Both maintenance_task and stock_reorder are "draft email → approve → send".
      if (!p || (p.kind !== 'maintenance_task' && p.kind !== 'stock_reorder')) {
        return apiError('Not a sendable email proposal', 400)
      }
      if (p.status === 'executed') return apiError('This email was already sent.', 409)

      const payload = (p.payload ?? {}) as {
        email_subject?: string
        email_body?: string
        recipient?: string
        maintenance_task_id?: string
        item_ids?: string[]
      }
      const isStock = p.kind === 'stock_reorder'
      const recipient =
        payload.recipient ||
        (isStock ? process.env.STOCK_EMAIL_RECIPIENT : process.env.MAINTENANCE_EMAIL_RECIPIENT)
      const subject = payload.email_subject
      const emailBody = payload.email_body
      if (!recipient) {
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
        // Best-effort confirmation — a Slack hiccup must never undo a sent email.
        try {
          const label = isStock ? '📦 *Stock reorder email sent*' : '🔧 *Maintenance email sent*'
          await postSlackText(`${label} to ${recipient}\n*${subject}*`, {
            type: isStock ? 'stock-reorder-sent' : 'maintenance-email-sent',
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
      }
      if (!payload.sms_text || !payload.email_subject || !payload.email_body) {
        return apiError('This proposal has no drafted message to send.', 422)
      }
      if (!payload.guest_email && !payload.guest_phone) {
        return apiError('No guest contact details on this booking.', 422)
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

    return apiError('Unknown action', 400)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Action failed')
  }
}
