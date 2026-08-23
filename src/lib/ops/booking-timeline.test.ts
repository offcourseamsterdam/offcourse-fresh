import { describe, it, expect } from 'vitest'
import { deriveBookingTimeline } from './booking-timeline'

const base = {
  status: 'confirmed',
  createdAt: '2026-08-01T10:00:00Z',
  hasCatering: false,
  cateringEmailSentAt: null,
  cateringConfirmedAt: null,
  captainAssigned: false,
  captainAssignedAt: null,
}

describe('deriveBookingTimeline', () => {
  it('marks confirmed done and catering steps not applicable when there is no catering', () => {
    const t = deriveBookingTimeline(base)
    expect(t.cancelled).toBe(false)
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.confirmed.done).toBe(true)
    expect(byKey.catering_ordered.applicable).toBe(false)
    expect(byKey.catering_confirmed.applicable).toBe(false)
    expect(byKey.captain_assigned.done).toBe(false)
  })

  it('walks through catering steps in order when catering is present', () => {
    const t = deriveBookingTimeline({
      ...base, hasCatering: true, cateringEmailSentAt: '2026-08-02T09:00:00Z',
    })
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.catering_ordered.applicable).toBe(true)
    expect(byKey.catering_ordered.done).toBe(true)
    expect(byKey.catering_ordered.occurredAt).toBe('2026-08-02T09:00:00Z')
    expect(byKey.catering_confirmed.done).toBe(false)
  })

  it('marks captain_assigned done with its timestamp when assigned', () => {
    const t = deriveBookingTimeline({
      ...base, captainAssigned: true, captainAssignedAt: '2026-08-03T08:00:00Z',
    })
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.captain_assigned.done).toBe(true)
    expect(byKey.captain_assigned.occurredAt).toBe('2026-08-03T08:00:00Z')
  })

  it('flags cancelled bookings without hiding what already happened', () => {
    const t = deriveBookingTimeline({ ...base, status: 'cancelled', hasCatering: true, cateringEmailSentAt: '2026-08-02T09:00:00Z' })
    expect(t.cancelled).toBe(true)
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.confirmed.done).toBe(true) // it WAS confirmed before being cancelled
    expect(byKey.catering_ordered.done).toBe(true) // and catering had already gone out
  })

  it('treats a captain-assigned step with no timestamp as done, not broken', () => {
    // the shared-cruise limitation documented in docs/plans/2026-08-07-booking-ops-timeline-plan.md
    const t = deriveBookingTimeline({ ...base, captainAssigned: true, captainAssignedAt: null })
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.captain_assigned.done).toBe(true)
    expect(byKey.captain_assigned.occurredAt).toBeNull()
  })
})
