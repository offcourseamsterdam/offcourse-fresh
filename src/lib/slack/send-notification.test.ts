import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The logging added to the Slack senders sits directly in the booking and payment
 * paths, so the guarantees that matter are negative ones: it must never throw, never
 * block a send, and never write a row for a message that was never sent.
 */

const h = vi.hoisted(() => ({ log: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./log-notification', () => ({ logSlackNotification: h.log }))

import { postSlackText, postSlackDM, postSlackCritical } from './send-notification'

const WEBHOOK = 'https://hooks.slack.test/abc'
const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SLACK_WEBHOOK_URL = WEBHOOK
  delete process.env.SLACK_BOT_TOKEN
  delete process.env.SLACK_ALERT_DM_CHANNEL
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('postSlackText', () => {
  it('posts to the webhook and logs the message as sent', async () => {
    await postSlackText('hello ops', 'booking.created')

    expect(fetch).toHaveBeenCalledWith(WEBHOOK, expect.objectContaining({ method: 'POST' }))
    expect(h.log).toHaveBeenCalledWith({
      kind: 'booking.created',
      destination: 'channel',
      text: 'hello ops',
      status: 'sent',
      error: null,
    })
  })

  it('logs nothing when no webhook is configured — nothing was sent', async () => {
    delete process.env.SLACK_WEBHOOK_URL

    await postSlackText('hello ops', 'booking.created')

    expect(fetch).not.toHaveBeenCalled()
    expect(h.log).not.toHaveBeenCalled()
  })

  it('records a failed row when Slack rejects the post', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await postSlackText('hello ops', 'cron.failed')

    expect(h.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'HTTP 500' }),
    )
  })

  it('records a failed row and never throws when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    await expect(postSlackText('hello ops', 'cron.failed')).resolves.toBeUndefined()
    expect(h.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'ECONNRESET' }),
    )
  })

  it('never throws when logging itself fails — a booking must not die over a log row', async () => {
    h.log.mockRejectedValueOnce(new Error('supabase down'))

    // logSlackNotification already swallows its own errors; this asserts the sender
    // does not DEPEND on that, because it runs inside the paid-booking path.
    await expect(postSlackText('hello ops', 'booking.created')).resolves.toBeUndefined()
  })
})

describe('postSlackDM', () => {
  it('returns false and logs nothing without a bot token', async () => {
    const sent = await postSlackDM('urgent', 'sweep.paid_but_unbooked')

    expect(sent).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(h.log).not.toHaveBeenCalled()
  })

  it('logs the DM with the channel it went to', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
    process.env.SLACK_ALERT_DM_CHANNEL = 'D123'

    const sent = await postSlackDM('urgent', 'sweep.paid_but_unbooked')

    expect(sent).toBe(true)
    expect(h.log).toHaveBeenCalledWith({
      kind: 'sweep.paid_but_unbooked',
      destination: 'dm',
      channel: 'D123',
      text: 'urgent',
      status: 'sent',
      error: null,
    })
  })

  it('logs a failed DM when Slack returns ok:false', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    }))

    const sent = await postSlackDM('urgent', 'sweep.paid_but_unbooked')

    expect(sent).toBe(false)
    expect(h.log).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'channel_not_found' }),
    )
  })
})

describe('postSlackCritical', () => {
  it('logs exactly one row — the DM — when the bot token is configured', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'

    await postSlackCritical('paid but unbooked', 'sweep.paid_but_unbooked')

    expect(h.log).toHaveBeenCalledTimes(1)
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ destination: 'dm', status: 'sent' }))
  })

  it('logs exactly one row — the channel fallback — when there is no bot token', async () => {
    await postSlackCritical('paid but unbooked', 'sweep.paid_but_unbooked')

    expect(h.log).toHaveBeenCalledTimes(1)
    expect(h.log).toHaveBeenCalledWith(
      expect.objectContaining({ destination: 'channel', status: 'sent' }),
    )
  })

  it('logs the failed DM AND the channel fallback when the DM is rejected', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    }))

    await postSlackCritical('paid but unbooked', 'sweep.paid_but_unbooked')

    // Both attempts are recorded: the dashboard should show the DM failing, not
    // just the fallback quietly succeeding.
    expect(h.log).toHaveBeenCalledTimes(2)
    expect(h.log.mock.calls.map(c => c[0].destination)).toEqual(['dm', 'channel'])
  })
})
