import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  postSlackText: vi.fn().mockResolvedValue(undefined),
  emailsSend: vi.fn().mockResolvedValue({ id: 'email_1' }),
}))

vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('resend', () => ({
  // Regular function (not arrow) so `new Resend()` works as a constructor.
  Resend: vi.fn(function () { return { emails: { send: h.emailsSend } } }),
}))

import { sendCriticalAlert } from './critical-alert'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('sendCriticalAlert', () => {
  it('always posts to Slack', async () => {
    await sendCriticalAlert('boom')
    expect(h.postSlackText).toHaveBeenCalledWith('boom')
  })

  it('also emails when a recipient + Resend key are configured', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('ALERT_EMAIL_RECIPIENT', 'ops@offcourseamsterdam.com')

    await sendCriticalAlert('*paid but unrecorded* `pi_1`', { subject: 'CRITICAL' })

    expect(h.postSlackText).toHaveBeenCalledTimes(1)
    expect(h.emailsSend).toHaveBeenCalledTimes(1)
    const arg = h.emailsSend.mock.calls[0][0]
    expect(arg.to).toBe('ops@offcourseamsterdam.com')
    expect(arg.subject).toBe('CRITICAL')
    // Slack markup is stripped for the plaintext email.
    expect(arg.text).toBe('paid but unrecorded pi_1')
  })

  it('skips the email leg when no recipient is configured (Slack still fires)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    // ALERT_EMAIL_RECIPIENT intentionally unset
    await sendCriticalAlert('boom')
    expect(h.postSlackText).toHaveBeenCalledTimes(1)
    expect(h.emailsSend).not.toHaveBeenCalled()
  })

  it('never throws even if both channels fail (alerting must not break the caller)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('ALERT_EMAIL_RECIPIENT', 'ops@offcourseamsterdam.com')
    h.postSlackText.mockRejectedValueOnce(new Error('slack down'))
    h.emailsSend.mockRejectedValueOnce(new Error('resend down'))

    await expect(sendCriticalAlert('boom')).resolves.toBeUndefined()
  })
})
