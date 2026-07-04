import { describe, it, expect, vi } from 'vitest'

// Mock the route's heavy server-only deps so importing it for the pure
// extractor stays cheap (no supabase/server-only/Gemini chain).
vi.mock('@/lib/slack/verify-request', () => ({ verifySlackSignature: vi.fn() }))
vi.mock('@/lib/slack/bot', () => ({ getSlackUserName: vi.fn() }))
vi.mock('@/lib/ai/describe-image', () => ({ fetchImageAsBase64: vi.fn() }))
vi.mock('@/lib/ghost/maintenance-drafter', () => ({ draftMaintenanceTask: vi.fn() }))

import { extractMaintenanceEvent } from './route'

/**
 * The intake rules — pure, so the one bug that would silently kill the feature
 * (dropping photo posts) is locked down. Slack delivers a photo upload as a
 * `message` event with subtype 'file_share' + a `files` array; that MUST be
 * accepted, while edits/joins/deletes/bot echoes must not.
 */

const CH = 'C_MAINT'

function callback(event: Record<string, unknown>, eventId = 'Ev123') {
  return { type: 'event_callback', event_id: eventId, event }
}

describe('extractMaintenanceEvent', () => {
  it('accepts a plain text message in the channel', () => {
    const out = extractMaintenanceEvent(callback({ type: 'message', channel: CH, user: 'U1', text: 'engine rattles' }), CH)
    expect(out).toMatchObject({ eventId: 'Ev123', text: 'engine rattles', userId: 'U1', files: [] })
  })

  it('ACCEPTS a photo upload (subtype file_share) — the core path', () => {
    const out = extractMaintenanceEvent(
      callback({
        type: 'message',
        subtype: 'file_share',
        channel: CH,
        user: 'U1',
        text: 'look at this',
        files: [{ mimetype: 'image/jpeg', url_private: 'https://files.slack.com/x.jpg' }],
      }),
      CH,
    )
    expect(out).not.toBeNull()
    expect(out!.files).toHaveLength(1)
  })

  it('rejects message edits, deletes, joins (other subtypes)', () => {
    for (const subtype of ['message_changed', 'message_deleted', 'channel_join', 'bot_message']) {
      expect(extractMaintenanceEvent(callback({ type: 'message', subtype, channel: CH, user: 'U1' }), CH)).toBeNull()
    }
  })

  it('rejects the bot\'s own messages', () => {
    expect(extractMaintenanceEvent(callback({ type: 'message', channel: CH, bot_id: 'B1', text: 'echo' }), CH)).toBeNull()
  })

  it('rejects messages from other channels', () => {
    expect(extractMaintenanceEvent(callback({ type: 'message', channel: 'C_OTHER', user: 'U1', text: 'hi' }), CH)).toBeNull()
  })

  it('returns null when the channel is not configured', () => {
    expect(extractMaintenanceEvent(callback({ type: 'message', channel: CH, user: 'U1', text: 'hi' }), undefined)).toBeNull()
  })

  it('ignores non-event_callback payloads', () => {
    expect(extractMaintenanceEvent({ type: 'url_verification', challenge: 'x' }, CH)).toBeNull()
  })

  it('falls back to event.ts when event_id is absent', () => {
    const out = extractMaintenanceEvent({ type: 'event_callback', event: { type: 'message', channel: CH, user: 'U1', text: 'hi', ts: '171.99' } }, CH)
    expect(out!.eventId).toBe('171.99')
  })
})
