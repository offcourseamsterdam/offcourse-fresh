import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyShiftAssigned } from './notify-assignment'
import { postDm } from '@/lib/slack/bot'
import { postSlackDM } from '@/lib/slack/send-notification'

vi.mock('@/lib/slack/bot', () => ({ postDm: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackDM: vi.fn().mockResolvedValue(true) }))

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
  it('posts directly to Beer DM with crew-call time, shift window, boat, and pay', async () => {
    const sb = makeSupabase({
      start_at: '2026-08-06T15:00:00Z',
      end_at: '2026-08-06T17:00:00Z',
      staff: { name: 'Joris', slack_member_id: 'U08PRAX8A07', hourly_rate_cents: 2500 },
      boats: { name: 'Diana' },
    })

    await notifyShiftAssigned(sb as never, 'shift-1')

    // Never DMs captain anymore
    expect(postDm).not.toHaveBeenCalled()
    expect(postSlackDM).toHaveBeenCalledTimes(1)
    const [text] = vi.mocked(postSlackDM).mock.calls[0]
    expect(text).toContain('Joris')
    expect(text).toContain('Diana')
    expect(text).toContain('€50.00') // 2h at €25/h
    expect(text).toContain('16:00') // crew call 1h before 17:00 Amsterdam
  })

  it('no-ops when the shift has no assigned staff', async () => {
    const sb = makeSupabase({ start_at: '2026-08-06T15:00:00Z', end_at: '2026-08-06T17:00:00Z', staff: null, boats: { name: 'Diana' } })

    await notifyShiftAssigned(sb as never, 'shift-1')

    expect(postDm).not.toHaveBeenCalled()
    expect(postSlackDM).not.toHaveBeenCalled()
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
    expect(postSlackDM).not.toHaveBeenCalled()
  })

  it('no-ops when the shift itself does not exist', async () => {
    const sb = makeSupabase(null)

    await notifyShiftAssigned(sb as never, 'shift-missing')

    expect(postDm).not.toHaveBeenCalled()
    expect(postSlackDM).not.toHaveBeenCalled()
  })
})

describe('who is allowed to be messaged', () => {
  it('never DMs captains — always routes to Beer DM', async () => {
    const sb = makeSupabase({
      start_at: '2026-08-06T15:00:00Z',
      end_at: '2026-08-06T17:00:00Z',
      staff: { name: 'Jannah Schenk', slack_member_id: 'U0JANNAH', hourly_rate_cents: 2500, slack_notifications_enabled: true },
      boats: { name: 'Diana' },
    })

    await notifyShiftAssigned(sb as never, 'shift-1')

    expect(postDm).not.toHaveBeenCalled()
    expect(postSlackDM).toHaveBeenCalledTimes(1)
    const [text] = vi.mocked(postSlackDM).mock.calls[0]
    expect(text).toContain('Jannah Schenk')
    expect(text).toContain('Diana')
  })
})
