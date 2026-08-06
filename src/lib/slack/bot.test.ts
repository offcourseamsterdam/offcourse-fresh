import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { postDm } from './bot'

vi.mock('./log', () => ({ logSlackMessage: vi.fn() }))

/**
 * Captures the Slack Web API calls postDm makes, so we can assert WHICH
 * methods it hits — the whole point of the U…/D… branch is that a D… id must
 * NOT go through conversations.open.
 */
function mockSlack(responses: Record<string, unknown>) {
  const calls: { method: string; body: Record<string, unknown> }[] = []
  const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
    const method = url.split('/').pop()!
    calls.push({ method, body: JSON.parse(init.body) })
    return {
      json: async () => responses[method] ?? { ok: false, error: 'not_mocked' },
    } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test-token')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('postDm', () => {
  it('opens a conversation first for a U… user id, then posts to the returned channel', async () => {
    const calls = mockSlack({
      'conversations.open': { ok: true, channel: { id: 'D0ARWPCQVJL' } },
      'chat.postMessage': { ok: true },
    })

    expect(await postDm('U08PRAX8A07', 'hello')).toBe(true)

    expect(calls.map(c => c.method)).toEqual(['conversations.open', 'chat.postMessage'])
    expect(calls[0].body).toEqual({ users: 'U08PRAX8A07' })
    expect(calls[1].body).toEqual({ channel: 'D0ARWPCQVJL', text: 'hello' })
  })

  it('posts straight to a D… id without calling conversations.open', async () => {
    // Regression: conversations.open({users: 'D…'}) fails with user_not_found,
    // which silently downgraded the whole DM to a shared-channel post.
    const calls = mockSlack({ 'chat.postMessage': { ok: true } })

    expect(await postDm('D08PRAXD13R', 'hello')).toBe(true)

    expect(calls.map(c => c.method)).toEqual(['chat.postMessage'])
    expect(calls[0].body).toEqual({ channel: 'D08PRAXD13R', text: 'hello' })
  })

  it('returns false when opening the conversation fails', async () => {
    mockSlack({ 'conversations.open': { ok: false, error: 'user_not_found' } })

    expect(await postDm('U_UNKNOWN', 'hello')).toBe(false)
  })

  it('returns false when the post itself fails, even after a successful open', async () => {
    mockSlack({
      'conversations.open': { ok: true, channel: { id: 'D123' } },
      'chat.postMessage': { ok: false, error: 'missing_scope' },
    })

    expect(await postDm('U08PRAX8A07', 'hello')).toBe(false)
  })

  it('returns false (and never calls Slack) without a bot token', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const calls = mockSlack({ 'chat.postMessage': { ok: true } })

    expect(await postDm('D08PRAXD13R', 'hello')).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
