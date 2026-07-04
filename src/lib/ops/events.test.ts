import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { emitOpsEvent } from './events'
import { createAdminClient } from '@/lib/supabase/admin'

function fakeSupabase(insertImpl?: (row: Record<string, unknown>) => unknown) {
  const captured: Record<string, unknown>[] = []
  const client = {
    captured,
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        captured.push(row)
        return Promise.resolve(insertImpl ? insertImpl(row) : { error: null })
      },
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any
}

describe('emitOpsEvent', () => {
  it('inserts a row with the given fields, defaulting optionals to null/empty', async () => {
    const supabase = fakeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase)

    await emitOpsEvent({
      eventType: 'booking_confirmed',
      actorType: 'system',
      bookingId: 'b1',
      source: 'webhooks/stripe',
    })

    expect(supabase.captured).toHaveLength(1)
    const row = supabase.captured[0]
    expect(row.event_type).toBe('booking_confirmed')
    expect(row.actor_type).toBe('system')
    expect(row.booking_id).toBe('b1')
    expect(row.shift_id).toBeNull()
    expect(row.staff_id).toBeNull()
    expect(row.proposal_id).toBeNull()
    expect(row.actor_id).toBeNull()
    expect(row.payload).toEqual({})
    expect(row.source).toBe('webhooks/stripe')
  })

  it('carries actor_id and payload through untouched', async () => {
    const supabase = fakeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(supabase)

    await emitOpsEvent({
      eventType: 'recommendation_created',
      actorType: 'agent',
      actorId: 'ops_optimizer',
      proposalId: 'p1',
      payload: { est_saving_cents: 4200 },
      source: 'ghost/ops-review',
    })

    const row = supabase.captured[0]
    expect(row.actor_id).toBe('ops_optimizer')
    expect(row.proposal_id).toBe('p1')
    expect(row.payload).toEqual({ est_saving_cents: 4200 })
  })

  it('never throws when the insert errors', async () => {
    const supabase = fakeSupabase(() => ({ error: { message: 'db down' } }))
    vi.mocked(createAdminClient).mockReturnValue(supabase)

    await expect(
      emitOpsEvent({ eventType: 'booking_cancelled', actorType: 'human', source: 'admin/bookings' }),
    ).resolves.toBeUndefined()
  })

  it('never throws when createAdminClient itself throws', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('no env')
    })

    await expect(
      emitOpsEvent({ eventType: 'booking_cancelled', actorType: 'human', source: 'admin/bookings' }),
    ).resolves.toBeUndefined()
  })
})
