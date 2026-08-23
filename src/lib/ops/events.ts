import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'

/**
 * ops_events — the append-only substrate the AI Operations Engine reads to
 * score decisions and (later) train forecasts. Distinct from admin_event_log
 * (human-facing ops/audit feed) and agent_proposals (one row per AI
 * recommendation) — see supabase/migrations/083_ops_events.sql.
 *
 * Every emit point in the codebase should reach for this, not admin_event_log,
 * when the event is something an optimizer might one day need to reason about.
 */
export type OpsEventType =
  | 'booking_created'
  | 'booking_paid'
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'booking_fh_failed'
  | 'booking_fh_recovered'
  | 'shift_assigned'
  | 'shift_unassigned'
  | 'recommendation_created'
  | 'recommendation_reviewed'
  | 'recommendation_approved'
  | 'recommendation_rejected'
  | 'guest_move_requested'
  | 'guest_move_accepted'
  | 'guest_move_declined'
  | 'guest_move_deferred'
  | 'guest_move_expired'
  | 'guest_move_rebooked'
  | 'catering_confirmed'
  | 'catering_order_sent'
  | 'ads_campaign_paused'
  | 'extras_upsell_sent'
  | 'availability_request_sent'
  | 'schedule_digest_sent'

export type OpsActorType = 'human' | 'agent' | 'system'

export interface OpsEvent {
  eventType: OpsEventType
  actorType: OpsActorType
  /** Admin email, agent key ('ops_optimizer'), or cron name. */
  actorId?: string | null
  bookingId?: string | null
  shiftId?: string | null
  staffId?: string | null
  proposalId?: string | null
  payload?: Record<string, unknown>
  /** Code path that emitted this, e.g. 'webhooks/stripe'. */
  source: string
}

/**
 * Fire-and-forget: never throws, never blocks the caller. A failed write here
 * must not break a booking, a shift assignment, or a proposal review — the
 * event log is valuable, but it is never the critical path.
 */
export async function emitOpsEvent(event: OpsEvent): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('ops_events').insert({
      event_type: event.eventType,
      actor_type: event.actorType,
      actor_id: event.actorId ?? null,
      booking_id: event.bookingId ?? null,
      shift_id: event.shiftId ?? null,
      staff_id: event.staffId ?? null,
      proposal_id: event.proposalId ?? null,
      payload: (event.payload ?? {}) as Json,
      source: event.source,
    })
    if (error) console.error('[ops/events] insert failed:', error.message)
  } catch (err) {
    console.error('[ops/events] emit failed:', err instanceof Error ? err.message : err)
  }
}
