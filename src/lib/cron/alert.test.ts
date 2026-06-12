import { describe, it, expect, vi, beforeEach } from 'vitest'
import { alertCronFailure } from './alert'
import { postSlackText } from '@/lib/slack/send-notification'

vi.mock('@/lib/slack/send-notification', () => ({
  postSlackText: vi.fn().mockResolvedValue(undefined),
}))

describe('alertCronFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('posts the cron name and error message to Slack', async () => {
    await alertCronFailure('payment-reminders', new Error('DB connection refused'))
    const text = vi.mocked(postSlackText).mock.calls[0][0]
    expect(text).toContain('payment-reminders')
    expect(text).toContain('DB connection refused')
  })

  it('stringifies non-Error values', async () => {
    await alertCronFailure('weekly-summary', 'plain string failure')
    expect(vi.mocked(postSlackText).mock.calls[0][0]).toContain('plain string failure')
  })

  it('includes the optional detail line', async () => {
    await alertCronFailure('extras-upsell', new Error('boom'), 'booking abc-123')
    expect(vi.mocked(postSlackText).mock.calls[0][0]).toContain('booking abc-123')
  })

  it('also logs to console.error for Vercel logs', async () => {
    const err = new Error('boom')
    await alertCronFailure('ads-guardrail', err)
    expect(console.error).toHaveBeenCalledWith('[cron/ads-guardrail] FAILED:', err)
  })
})
