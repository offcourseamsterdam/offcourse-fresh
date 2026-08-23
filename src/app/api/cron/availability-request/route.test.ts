import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import type { CaptainMonthStatus } from '@/lib/scheduling/availability-status'

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  postDm: vi.fn().mockResolvedValue(true),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  emitOpsEvent: vi.fn().mockResolvedValue(undefined),
  checkAvailabilityRequest: vi.fn(),
  checkAvailabilityReminder: vi.fn(),
  getMonthAvailabilityStatus: vi.fn(),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/slack/bot', () => ({ postDm: h.postDm }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: h.emitOpsEvent }))
vi.mock('@/lib/scheduling/availability-request', () => ({
  checkAvailabilityRequest: h.checkAvailabilityRequest,
  checkAvailabilityReminder: h.checkAvailabilityReminder,
}))
// captainAvailabilityUrl stays REAL — the link landing in the DM is one of
// the things these tests exist to prove.
vi.mock('@/lib/scheduling/availability-status', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/scheduling/availability-status')>()
  return { ...actual, getMonthAvailabilityStatus: h.getMonthAvailabilityStatus }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { GET } from './route'

const req = {} as NextRequest
const OCT = { targetMonth: '2026-10', targetMonthStart: '2026-10-01' }

function captain(over: Partial<CaptainMonthStatus> & { name: string }): CaptainMonthStatus {
  return {
    staffId: `id-${over.name}`,
    slackMemberId: 'U123',
    slackNotificationsEnabled: true,
    daysFilled: 0,
    hasResponded: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireCronSecret.mockReturnValue(null)
  h.postDm.mockResolvedValue(true)
  h.checkAvailabilityRequest.mockReturnValue(null)
  h.checkAvailabilityReminder.mockReturnValue(null)
  h.getMonthAvailabilityStatus.mockResolvedValue([])
})

describe('GET /api/cron/availability-request — the first ask', () => {
  it('does nothing on a day that is neither trigger date', async () => {
    const res = await GET(req)
    expect(await res.json()).toEqual({ ok: true, sent: 0, reason: 'not a trigger day' })
    expect(h.postDm).not.toHaveBeenCalled()
  })

  it('DMs every active captain, responded or not, with a real link to the calendar', async () => {
    h.checkAvailabilityRequest.mockReturnValue(OCT)
    h.getMonthAvailabilityStatus.mockResolvedValue([
      captain({ name: 'Bas', slackMemberId: 'U123' }),
      // Already filled some days in — the FIRST ask still goes to them.
      captain({ name: 'Mare', slackMemberId: 'U456', daysFilled: 8, hasResponded: true }),
    ])

    const res = await GET(req)
    const json = await res.json()

    expect(h.postDm).toHaveBeenCalledTimes(2)
    expect(json).toMatchObject({ ok: true, targetMonth: '2026-10', isFollowUp: false, sent: 2 })

    // The bug this replaces: the DM used to say "head to your availability
    // calendar" with no URL at all.
    const [, body] = h.postDm.mock.calls[0]
    expect(body).toContain('October 2026')
    expect(body).toContain('/en/captain/availability')
  })

  it('skips a captain who has notifications turned off, without counting them as unreachable', async () => {
    h.checkAvailabilityRequest.mockReturnValue(OCT)
    h.getMonthAvailabilityStatus.mockResolvedValue([
      captain({ name: 'Bas', slackMemberId: 'U123' }),
      captain({ name: 'Jannah', slackMemberId: 'U456', slackNotificationsEnabled: false }),
    ])

    const json = await (await GET(req)).json()

    expect(h.postDm).toHaveBeenCalledTimes(1)
    expect(json).toMatchObject({ sent: 1, optedOut: 1, noSlackId: 0 })
  })

  it('alerts Slack about captains with no Slack ID instead of silently skipping them', async () => {
    h.checkAvailabilityRequest.mockReturnValue(OCT)
    h.getMonthAvailabilityStatus.mockResolvedValue([
      captain({ name: 'Bas', slackMemberId: 'U123' }),
      captain({ name: 'Bo', slackMemberId: null }),
    ])

    const json = await (await GET(req)).json()

    expect(json.noSlackId).toBe(1)
    expect(h.postSlackText).toHaveBeenCalledWith(expect.stringContaining('1 captain(s) have no Slack ID'))
  })

  it('rejects when the cron secret is missing', async () => {
    const denied = new Response('denied', { status: 401 })
    h.requireCronSecret.mockReturnValue(denied)

    expect(await GET(req)).toBe(denied)
    expect(h.checkAvailabilityRequest).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/availability-request — the follow-up nudge (Beer, 2026-08-23)', () => {
  it('chases ONLY the captains who still have nothing filled in', async () => {
    h.checkAvailabilityReminder.mockReturnValue(OCT)
    h.getMonthAvailabilityStatus.mockResolvedValue([
      captain({ name: 'Bas', slackMemberId: 'U-bas' }),
      captain({ name: 'Mare', slackMemberId: 'U-mare', daysFilled: 12, hasResponded: true }),
      captain({ name: 'Bo', slackMemberId: 'U-bo' }),
    ])

    const json = await (await GET(req)).json()

    expect(json).toMatchObject({ isFollowUp: true, sent: 2 })
    const dmd = h.postDm.mock.calls.map(c => c[0])
    expect(dmd).toEqual(['U-bas', 'U-bo'])
    expect(dmd).not.toContain('U-mare') // already responded — never chased
    expect(h.postDm.mock.calls[0][1]).toContain('still don\'t have your availability')
  })

  it('says so in Slack when everyone has already responded, rather than going silent', async () => {
    h.checkAvailabilityReminder.mockReturnValue(OCT)
    h.getMonthAvailabilityStatus.mockResolvedValue([
      captain({ name: 'Mare', daysFilled: 12, hasResponded: true }),
    ])

    const json = await (await GET(req)).json()

    expect(json).toMatchObject({ isFollowUp: true, sent: 0 })
    expect(h.postDm).not.toHaveBeenCalled()
    expect(h.postSlackText).toHaveBeenCalledWith(expect.stringContaining('Everyone has filled in'))
  })

  it('the first ask wins if both dates somehow coincide — never two DMs in one day', async () => {
    h.checkAvailabilityRequest.mockReturnValue(OCT)
    h.checkAvailabilityReminder.mockReturnValue(OCT)
    h.getMonthAvailabilityStatus.mockResolvedValue([captain({ name: 'Bas' })])

    const json = await (await GET(req)).json()

    expect(json).toMatchObject({ isFollowUp: false, sent: 1 })
    expect(h.postDm).toHaveBeenCalledTimes(1)
  })
})
