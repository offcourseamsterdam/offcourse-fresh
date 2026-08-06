import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyShiftAssigned } from './notify-assignment'
import { postDm } from '@/lib/slack/bot'
import { postSlackText } from '@/lib/slack/send-notification'

vi.mock('@/lib/slack/bot', () => ({ postDm: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: vi.fn().mockResolvedValue(undefined) }))

function makeSupabase(row: unknown) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row })),
        })),
      })),
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notifyShiftAssigned', () => {
  it('DMs the captain with crew-call time, shift window, boat, and pay when a Slack ID is on file', async () => {
    const sb = makeSupabase({
      start_at: '2026-08-06T15:00:00Z',
      end_at: '2026-08-06T17:00:00Z',
      staff: { name: 'Joris', slack_member_id: 'U08PRAX8A07', hourly_rate_cents: 2500 },
      boats: { name: 'Diana' },
    })

    await notifyShiftAssigned(sb as never, 'shift-1')

    expect(postDm).toHaveBeenCalledTimes(1)
    const [slackId, text] = vi.mocked(postDm).mock.calls[0]
    expect(slackId).toBe('U08PRAX8A07')
    expect(text).toContain('Diana')
    expect(text).toContain('€50.00') // 2h at €25/h
    expect(postSlackText).not.toHaveBeenCalled()
  })

  it('includes a crew-call time one hour before the shift start', async () => {
    const sb = makeSupabase({
      start_at: '2026-08-06T15:00:00Z',
      end_at: '2026-08-06T17:00:00Z',
      staff: { name: 'Joris', slack_member_id: 'U08PRAX8A07', hourly_rate_cents: 2500 },
      boats: { name: 'Diana' },
    })

    await notifyShiftAssigned(sb as never, 'shift-1')

    const text = vi.mocked(postDm).mock.calls[0][1]
    // 15:00 UTC on 2026-08-06 is 17:00 Amsterdam (summer/CEST) — crew call is 1h before departure.
    expect(text).toContain('16:00')
  })

  it('falls back to the shared channel post when the captain has no Slack ID on file', async () => {
    const sb = makeSupabase({
      start_at: '2026-08-06T15:00:00Z',
      end_at: '2026-08-06T17:00:00Z',
      staff: { name: 'Joris', slack_member_id: null, hourly_rate_cents: 2500 },
      boats: { name: 'Diana' },
    })

    await notifyShiftAssigned(sb as never, 'shift-1')

    expect(postDm).not.toHaveBeenCalled()
    expect(postSlackText).toHaveBeenCalledTimes(1)
    expect(vi.mocked(postSlackText).mock.calls[0][0]).toContain('Joris')
  })

  it('falls back to the channel post — with a DIFFERENT reason — when the DM itself fails despite a Slack ID on file', async () => {
    vi.mocked(postDm).mockResolvedValueOnce(false) // e.g. missing SLACK_BOT_TOKEN, revoked auth
    const sb = makeSupabase({
      start_at: '2026-08-06T15:00:00Z',
      end_at: '2026-08-06T17:00:00Z',
      staff: { name: 'Joris', slack_member_id: 'U08PRAX8A07', hourly_rate_cents: 2500 },
      boats: { name: 'Diana' },
    })

    await notifyShiftAssigned(sb as never, 'shift-1')

    expect(postDm).toHaveBeenCalledTimes(1) // it was attempted, unlike the no-slack-id case
    expect(postSlackText).toHaveBeenCalledTimes(1)
    const [text] = vi.mocked(postSlackText).mock.calls[0]
    expect(text).toContain('DM failed')
    expect(text).not.toContain('no Slack ID on file') // must not blame the wrong cause
  })

  it('no-ops when the shift has no assigned staff', async () => {
    const sb = makeSupabase({ start_at: '2026-08-06T15:00:00Z', end_at: '2026-08-06T17:00:00Z', staff: null, boats: { name: 'Diana' } })

    await notifyShiftAssigned(sb as never, 'shift-1')

    expect(postDm).not.toHaveBeenCalled()
    expect(postSlackText).not.toHaveBeenCalled()
  })

  it('no-ops when the shift has no boat', async () => {
    const sb = makeSupabase({
      start_at: '2026-08-06T15:00:00Z',
      end_at: '2026-08-06T17:00:00Z',
      staff: { name: 'Joris', slack_member_id: 'U08PRAX8A07', hourly_rate_cents: 2500 },
      boats: null,
    })

    await notifyShiftAssigned(sb as never, 'shift-1')

    expect(postDm).not.toHaveBeenCalled()
    expect(postSlackText).not.toHaveBeenCalled()
  })

  it('no-ops when the shift itself does not exist', async () => {
    const sb = makeSupabase(null)

    await notifyShiftAssigned(sb as never, 'shift-missing')

    expect(postDm).not.toHaveBeenCalled()
    expect(postSlackText).not.toHaveBeenCalled()
  })
})
