import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./log', () => ({ logSlackMessage: vi.fn() }))
vi.mock('./bot', () => ({ postToChannel: vi.fn().mockResolvedValue(undefined) }))

import { postSlackText } from './send-notification'
import { postToChannel } from './bot'

/**
 * The dev redirect is a guardrail: local testing must NEVER page the shared
 * team channel — everything goes to Beer's DM instead (Beer 2026-07-04).
 */
describe('postSlackText — dev redirect', () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/team-channel')
  })

  it('development: sends ONLY to Beer\'s DM with a [dev] prefix — the webhook is never called', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    await postSlackText('New booking confirmed!')

    expect(postToChannel).toHaveBeenCalledWith('D08PRAXD13R', '[dev] New booking confirmed!')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('development: SLACK_DEV_DM_CHANNEL overrides the DM target', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SLACK_DEV_DM_CHANNEL', 'D0OTHER')

    await postSlackText('ping')

    expect(postToChannel).toHaveBeenCalledWith('D0OTHER', '[dev] ping')
  })

  it('production: posts to the webhook, not the DM', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    await postSlackText('New booking confirmed!')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.test/team-channel',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(postToChannel).not.toHaveBeenCalled()
  })

  it('production without a webhook URL: silent no-op', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SLACK_WEBHOOK_URL', '')

    await expect(postSlackText('x')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
