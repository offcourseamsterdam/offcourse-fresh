/**
 * Derives a booking's ops timeline from real state, not from the ops_events
 * log — emitOpsEvent is fire-and-forget and can silently fail (by design,
 * see src/lib/ops/events.ts), so it must never be the source of truth for
 * "did this happen." It's only used (by the caller, before this function
 * runs) to fill in `captainAssignedAt`, the one step with no dedicated
 * timestamp column of its own.
 */

export type BookingTimelineStepKey =
  | 'confirmed'
  | 'catering_ordered'
  | 'catering_confirmed'
  | 'captain_assigned'

export interface BookingTimelineStep {
  key: BookingTimelineStepKey
  label: string
  applicable: boolean
  done: boolean
  occurredAt: string | null
}

export interface BookingTimelineInput {
  status: string | null
  createdAt: string | null
  hasCatering: boolean
  cateringEmailSentAt: string | null
  cateringConfirmedAt: string | null
  captainAssigned: boolean
  captainAssignedAt: string | null
}

export interface BookingTimeline {
  cancelled: boolean
  steps: BookingTimelineStep[]
}

export function deriveBookingTimeline(input: BookingTimelineInput): BookingTimeline {
  const cancelled = input.status === 'cancelled'

  return {
    cancelled,
    steps: [
      {
        key: 'confirmed',
        label: 'Booking confirmed',
        applicable: true,
        // A cancelled booking was, by definition, confirmed at some point first.
        done: cancelled || input.status === 'confirmed' || input.status === 'booked',
        occurredAt: input.createdAt,
      },
      {
        key: 'catering_ordered',
        label: 'Catering order sent to supplier',
        applicable: input.hasCatering,
        done: !!input.cateringEmailSentAt,
        occurredAt: input.cateringEmailSentAt,
      },
      {
        key: 'catering_confirmed',
        label: 'Supplier confirmed the order',
        applicable: input.hasCatering,
        done: !!input.cateringConfirmedAt,
        occurredAt: input.cateringConfirmedAt,
      },
      {
        key: 'captain_assigned',
        label: 'Captain assigned',
        applicable: true,
        done: input.captainAssigned,
        occurredAt: input.captainAssignedAt,
      },
    ],
  }
}
