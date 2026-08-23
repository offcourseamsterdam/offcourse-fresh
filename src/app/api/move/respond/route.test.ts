import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: vi.fn().mockResolvedValue(undefined) }))

import { POST } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitOpsEvent } from '@/lib/ops/events'
import { generateMoveToken } from '@/lib/ops/move-token'

const PROPOSAL_ID = 'p1'
const TOKEN = generateMoveToken(PROPOSAL_ID)

function makeReq(body: unknown) {
  return { json: async () => body } as never
}

const BASE_PAYLOAD = {
  guest_name: 'Sophie Russell',
  guest_email: 'sophie@example.com',
  guest_phone: '+31600000000',
  cruise_title: 'Hidden Gems Cruise',
  target_date: '2026-08-26',
  booking_id: 'booking-1',
  current_start_at: '2026-08-26T17:00:00Z',
  proposed_start_at: '2026-08-25T17:00:00Z',
}

/** Route-shaped Supabase stub — `updates`/`inserts` capture every write for assertions. */
function makeSupabase({ proposal }: { proposal: unknown }) {
  const updates: Record<string, unknown>[] = []
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const from = vi.fn((table: string) => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: proposal }) }) }),
    update: (row: Record<string, unknown>) => {
      updates.push(row)
      return { eq: () => Promise.resolve({ error: null }) }
    },
    insert: (row: Record<string, unknown>) => {
      inserts.push({ table, row })
      return Promise.resolve({ error: null })
    },
  }))
  return { client: { from }, updates, inserts }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/move/respond', () => {
  it('rejects an invalid token without touching the database', async () => {
    const sb = makeSupabase({ proposal: null })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ proposalId: PROPOSAL_ID, token: 'wrong', response: 'accept' }))
    expect(res.status).toBe(403)
    expect(sb.updates).toHaveLength(0)
  })

  it('rejects an unrecognized response value', async () => {
    const sb = makeSupabase({ proposal: null })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ proposalId: PROPOSAL_ID, token: TOKEN, response: 'maybe' }))
    expect(res.status).toBe(400)
  })

  it('accept: marks executed, does NOT record an opt-out, and emits guest_move_accepted', async () => {
    const sb = makeSupabase({
      proposal: { id: PROPOSAL_ID, kind: 'guest_move_request', status: 'approved', payload: BASE_PAYLOAD, outcome: {} },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ proposalId: PROPOSAL_ID, token: TOKEN, response: 'accept' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { recorded: 'accept' } })

    expect(sb.updates[0]).toMatchObject({ status: 'executed', outcome: expect.objectContaining({ guest_response: 'accept' }) })
    expect(sb.inserts.find(i => i.table === 'reschedule_opt_outs')).toBeUndefined()
    expect(emitOpsEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'guest_move_accepted' }))
  })

  it('decline: marks executed AND records a permanent opt-out by email + phone (Beer, 2026-08-23: "one decline, never ask that guest again")', async () => {
    const sb = makeSupabase({
      proposal: { id: PROPOSAL_ID, kind: 'guest_move_request', status: 'approved', payload: BASE_PAYLOAD, outcome: {} },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ proposalId: PROPOSAL_ID, token: TOKEN, response: 'decline' }))
    expect(res.status).toBe(200)

    expect(sb.updates[0]).toMatchObject({ status: 'executed', outcome: expect.objectContaining({ guest_response: 'decline' }) })
    const optOut = sb.inserts.find(i => i.table === 'reschedule_opt_outs')
    expect(optOut?.row).toMatchObject({
      email: 'sophie@example.com',
      phone: '+31600000000',
      booking_id: 'booking-1',
      proposal_id: PROPOSAL_ID,
    })
    expect(emitOpsEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'guest_move_declined' }))
  })

  it('rejects "defer" as a new response — removed 2026-08-23, it never resolved to anything different from silence', async () => {
    const sb = makeSupabase({
      proposal: { id: PROPOSAL_ID, kind: 'guest_move_request', status: 'approved', payload: BASE_PAYLOAD, outcome: {} },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ proposalId: PROPOSAL_ID, token: TOKEN, response: 'defer' }))
    expect(res.status).toBe(400)
    expect(sb.updates).toHaveLength(0)
  })

  it('idempotent: a second tap after accept/decline just echoes the recorded answer, no second write', async () => {
    const sb = makeSupabase({
      proposal: {
        id: PROPOSAL_ID,
        kind: 'guest_move_request',
        status: 'executed',
        payload: BASE_PAYLOAD,
        outcome: { guest_response: 'decline', responded_at: '2026-08-24T10:00:00Z' },
      },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ proposalId: PROPOSAL_ID, token: TOKEN, response: 'accept' }))
    expect(await res.json()).toEqual({ ok: true, data: { recorded: 'decline', already: true } })
    expect(sb.updates).toHaveLength(0)
    expect(sb.inserts).toHaveLength(0)
  })

  it('a HISTORICAL "defer" outcome (from before 2026-08-23) can still be answered — not treated as already-final', async () => {
    const sb = makeSupabase({
      proposal: {
        id: PROPOSAL_ID,
        kind: 'guest_move_request',
        status: 'approved',
        payload: BASE_PAYLOAD,
        outcome: { guest_response: 'defer', responded_at: '2026-08-24T10:00:00Z' },
      },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ proposalId: PROPOSAL_ID, token: TOKEN, response: 'accept' }))
    expect(await res.json()).toEqual({ ok: true, data: { recorded: 'accept' } })
    expect(sb.updates).toHaveLength(1)
  })

  it('refuses to answer a request that already expired', async () => {
    const sb = makeSupabase({
      proposal: { id: PROPOSAL_ID, kind: 'guest_move_request', status: 'expired', payload: BASE_PAYLOAD, outcome: {} },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ proposalId: PROPOSAL_ID, token: TOKEN, response: 'accept' }))
    expect(res.status).toBe(410)
    expect(sb.updates).toHaveLength(0)
  })

  it('decline with only a phone on file (no email) still records the opt-out by phone alone', async () => {
    const sb = makeSupabase({
      proposal: {
        id: PROPOSAL_ID,
        kind: 'guest_move_request',
        status: 'approved',
        payload: { ...BASE_PAYLOAD, guest_email: null },
        outcome: {},
      },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await POST(makeReq({ proposalId: PROPOSAL_ID, token: TOKEN, response: 'decline' }))

    const optOut = sb.inserts.find(i => i.table === 'reschedule_opt_outs')
    expect(optOut?.row).toMatchObject({ email: null, phone: '+31600000000' })
  })
})
