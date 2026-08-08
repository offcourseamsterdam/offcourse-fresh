import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  postDm: vi.fn().mockResolvedValue(true),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  emitOpsEvent: vi.fn().mockResolvedValue(undefined),
  isScheduleDigestTime: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/slack/bot', () => ({ postDm: h.postDm }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: h.emitOpsEvent }))
vi.mock('@/lib/scheduling/schedule-digest', async () => {
  const actual = await vi.importActual('@/lib/scheduling/schedule-digest')
  return { ...actual, isScheduleDigestTime: h.isScheduleDigestTime }
})

const shifts = [
  {
    staff_id: 'staff-1',
    start_at: '2026-08-09T13:00:00Z',
    end_at: '2026-08-09T15:00:00Z',
    staff: { name: 'Beer Zoomers', slack_member_id: 'U123' },
    boats: { name: 'Diana' },
  },
  {
    staff_id: 'staff-2',
    start_at: '2026-08-09T17:00:00Z',
    end_at: '2026-08-09T18:30:00Z',
    staff: { name: 'Jannah Schenk', slack_member_id: null },
    boats: { name: 'Curaçao' },
  },
]

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: shifts, error: null }),
        }),
      }),
    }),
  }),
}))

import { GET } from './route'

const req = {} as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  h.requireCronSecret.mockReturnValue(null)
  h.isScheduleDigestTime.mockReturnValue(true)
  h.postDm.mockResolvedValue(true)
})

describe('GET /api/cron/schedule-digest', () => {
  it('does nothing outside the digest hour', async () => {
    h.isScheduleDigestTime.mockReturnValue(false)

    const res = await GET(req)
    const json = await res.json()

    expect(json).toEqual({ ok: true, sent: 0, reason: 'not the digest hour' })
    expect(h.postDm).not.toHaveBeenCalled()
  })

  it('DMs each captain with a Slack ID their tomorrow digest, and flags the one without', async () => {
    const res = await GET(req)
    const json = await res.json()

    expect(h.postDm).toHaveBeenCalledTimes(1)
    expect(h.postDm).toHaveBeenCalledWith('U123', expect.stringContaining('Diana'), expect.any(Object))
    expect(json).toEqual({ ok: true, date: expect.any(String), sent: 1, noSlackId: 1 })
    expect(h.postSlackText).toHaveBeenCalledWith(expect.stringContaining('1 captain(s) have no Slack ID'))
    expect(h.emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'schedule_digest_sent', payload: expect.objectContaining({ sent: 1, noSlackId: 1, captainsWithShifts: 2 }) }),
    )
  })

  it('rejects when the cron secret is missing', async () => {
    const denied = new Response('denied', { status: 401 })
    h.requireCronSecret.mockReturnValue(denied)

    const res = await GET(req)

    expect(res).toBe(denied)
    expect(h.postDm).not.toHaveBeenCalled()
  })
})
