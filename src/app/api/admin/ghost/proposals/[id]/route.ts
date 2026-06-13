import { NextRequest, after } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'
import { analyzeDifference } from '@/lib/ghost/compare'
import { prepareInboxBookingBody } from '@/lib/ghost/book-from-proposal'
import type { BookingProposalInput } from '@/lib/ghost/dry-run'

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
 * Everything except `book` is read-only toward customers.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { action?: string; reviewed?: boolean }
    const supabase = createAdminClient()

    if (body.action === 'review') {
      const reviewed_at = body.reviewed === false ? null : new Date().toISOString()
      const { error } = await supabase.from('agent_proposals').update({ reviewed_at }).eq('id', id)
      if (error) return apiError(error.message, 500)
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

      const prep = await prepareInboxBookingBody(proposalBooking, contact)
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

        return apiOk({ booking: bookJson.data })
      } catch (bookErr) {
        await supabase.from('agent_proposals').update({ status: 'shadow' }).eq('id', id)
        throw bookErr
      }
    }

    return apiError('Unknown action', 400)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Action failed')
  }
}
