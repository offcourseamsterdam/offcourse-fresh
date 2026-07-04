import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidMoveToken } from '@/lib/ops/move-token'
import { emitOpsEvent } from '@/lib/ops/events'
import { postSlackText } from '@/lib/slack/send-notification'
import { formatAmsterdamTime } from '@/lib/utils'

/**
 * POST /api/move/respond { proposalId, token, response }
 *
 * The guest's answer to a move request — reached from the tokened link in
 * their SMS/email, no login. Three answers:
 *   accept  — "Yes, that's fine"      → status 'executed'; Slack pings the team
 *             to perform the ACTUAL rebook in admin (a guest yes never touches
 *             FareHarbor by itself — the autonomy ceiling holds).
 *   defer   — "Let me check"          → stays 'approved' (awaiting); logged.
 *   decline — "Keep my original time" → status 'executed'; nothing changes for
 *             the guest; the ops slot is freed for other ideas.
 *
 * Every answer lands in ops_events — the acceptance-probability training data.
 * Idempotent: a second tap returns the recorded answer instead of overwriting.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      proposalId?: string
      token?: string
      response?: string
    }
    const { proposalId, token, response } = body
    if (!proposalId || !token || !isValidMoveToken(proposalId, token)) {
      return apiError('Invalid link', 403)
    }
    if (response !== 'accept' && response !== 'defer' && response !== 'decline') {
      return apiError('Invalid response', 400)
    }

    const supabase = createAdminClient()
    const { data: p } = await supabase
      .from('agent_proposals')
      .select('id, kind, status, payload, outcome')
      .eq('id', proposalId)
      .single()
    if (!p || p.kind !== 'guest_move_request') return apiError('Not found', 404)

    const outcome = (p.outcome ?? {}) as Record<string, unknown>
    // Idempotency: once accepted/declined, later taps just echo the answer.
    if (typeof outcome.guest_response === 'string' && outcome.guest_response !== 'defer') {
      return apiOk({ recorded: outcome.guest_response, already: true })
    }
    // Only a sent request can be answered ('approved' = sent, awaiting).
    if (p.status !== 'approved' && p.status !== 'executed') {
      return apiError('This request is no longer active', 410)
    }

    const payload = (p.payload ?? {}) as {
      guest_name?: string | null
      cruise_title?: string | null
      target_date?: string
      booking_id?: string
      current_start_at?: string
      proposed_start_at?: string
    }

    const nextOutcome = JSON.parse(
      JSON.stringify({
        ...outcome,
        guest_response: response,
        responded_at: new Date().toISOString(),
      }),
    )
    await supabase
      .from('agent_proposals')
      .update({
        outcome: nextOutcome,
        // defer keeps the request open (awaiting a real answer / expiry sweep)
        ...(response === 'defer' ? {} : { status: 'executed' }),
      })
      .eq('id', proposalId)

    const eventType =
      response === 'accept' ? 'guest_move_accepted' : response === 'decline' ? 'guest_move_declined' : 'guest_move_deferred'
    await emitOpsEvent({
      eventType,
      actorType: 'human',
      actorId: 'guest',
      proposalId,
      bookingId: payload.booking_id ?? null,
      source: 'api/move/respond',
      payload: { target_date: payload.target_date },
    })

    const who = payload.guest_name ?? 'The guest'
    const when = payload.proposed_start_at ? formatAmsterdamTime(payload.proposed_start_at) : '?'
    const was = payload.current_start_at ? formatAmsterdamTime(payload.current_start_at) : '?'
    try {
      if (response === 'accept') {
        await postSlackText(
          `🎉 *${who} accepted the move* — ${payload.cruise_title ?? 'cruise'} on ${payload.target_date}: ${was} → ${when}.\n*Action needed:* rebook it in FareHarbor via admin, and don't forget the promised bottle of wine.`,
          { type: 'guest-move-accepted', triggeredBy: 'guest' },
        )
      } else if (response === 'decline') {
        await postSlackText(
          `🙅 *${who} keeps the original time* (${payload.cruise_title ?? 'cruise'}, ${payload.target_date} ${was}). No action needed.`,
          { type: 'guest-move-declined', triggeredBy: 'guest' },
        )
      }
    } catch {
      /* swallow — the recorded answer is what matters */
    }

    return apiOk({ recorded: response })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to record response')
  }
}
