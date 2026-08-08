import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  postDm: vi.fn().mockResolvedValue(true),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  emitOpsEvent: vi.fn().mockResolvedValue(undefined),
  checkAvailabilityRequest: vi.fn(),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/slack/bot', () => ({ postDm: h.postDm }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: h.emitOpsEvent }))
vi.mock('@/lib/scheduling/availability-request', () => ({ checkAvailabilityRequest: h.checkAvailabilityRequest }))

const staff = [
  { id: 'staff-1', name: 'Beer Zoomers', slack_member_id: 'U123' },
  { id: 'staff-2', name: 'Jannah Schenk', slack_member_id: 'U456' },
]

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: staff, error: null }),
      }),
    }),
  }),
}))

import { GET } from './route'

const req = {} as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  h.requireCronSecret.mockReturnValue(null)
  h.postDm.mockResolvedValue(true)
})

describe('GET /api/cron/availability-request', () => {
  it('does nothing on a day that is not a trigger day', async () => {
    h.checkAvailabilityRequest.mockReturnValue(null)

    const res = await GET(req)
    const json = await res.json()

    expect(json).toEqual({ ok: true, sent: 0, reason: 'not a trigger day' })
    expect(h.postDm).not.toHaveBeenCalled()
  })

  it('DMs every active staff member with a Slack ID on a trigger day', async () => {
    h.checkAvailabilityRequest.mockReturnValue({ targetMonth: '2026-10', targetMonthStart: '2026-10-01' })

    const res = await GET(req)
    const json = await res.json()

    expect(h.postDm).toHaveBeenCalledTimes(2)
    expect(h.postDm).toHaveBeenCalledWith('U123', expect.stringContaining('October 2026'), expect.any(Object))
    expect(json).toEqual({ ok: true, targetMonth: '2026-10', sent: 2, noSlackId: 0 })
    expect(h.emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'availability_request_sent', payload: expect.objectContaining({ targetMonth: '2026-10' }) }),
    )
  })

  it('alerts Slack about staff with no Slack ID instead of silently skipping them', async () => {
    h.checkAvailabilityRequest.mockReturnValue({ targetMonth: '2026-10', targetMonthStart: '2026-10-01' })
    staff.push({ id: 'staff-3', name: 'No Slack Guy', slack_member_id: null as unknown as string })

    const res = await GET(req)
    const json = await res.json()

    expect(json.noSlackId).toBe(1)
    expect(h.postSlackText).toHaveBeenCalledWith(expect.stringContaining('1 captain(s) have no Slack ID'))
    staff.pop()
  })

  it('rejects when the cron secret is missing', async () => {
    const denied = new Response('denied', { status: 401 })
    h.requireCronSecret.mockReturnValue(denied)

    const res = await GET(req)

    expect(res).toBe(denied)
    expect(h.checkAvailabilityRequest).not.toHaveBeenCalled()
  })
})
