import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio/verify-signature', () => ({ verifyTwilioSignature: vi.fn() }))
vi.mock('@/lib/webhooks/log', () => ({ logWebhookEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/chat/shadow-drafter', () => ({ draftShadowReply: vi.fn().mockResolvedValue(undefined) }))
// after() needs a real Next.js request scope, absent when calling POST directly
// in a unit test — run the callback inline instead (fire-and-forget → forget-now).
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => cb() }
})

import { POST } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'

function makeReq(params: Record<string, string>, conversationId: string | null = 'convo-1', signature: string | null = 'valid-sig') {
  const formData = new Map(Object.entries(params))
  const search = conversationId ? `?conversationId=${conversationId}` : ''
  return {
    formData: async () => formData,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-twilio-signature' ? signature : null) },
    nextUrl: {
      pathname: '/api/webhooks/twilio-voice/recording',
      search,
      searchParams: new URLSearchParams(search),
    },
  } as never
}

function makeSupabase({ updatedMessageId = 'msg-1' }: { updatedMessageId?: string | null } = {}) {
  const updatedMessages: Array<Record<string, unknown>> = []
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {
      update: (payload: Record<string, unknown>) => {
        updatedMessages.push(payload)
        return builder
      },
      eq: () => builder,
      select: () => builder,
      maybeSingle: async () => ({ data: updatedMessageId ? { id: updatedMessageId } : null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return builder
  })
  return { client: { from }, updatedMessages }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/webhooks/twilio-voice/recording', () => {
  it('saves the transcript and hands the conversation to Ghost', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(
      makeReq({ CallSid: 'CA123', TranscriptionStatus: 'completed', TranscriptionText: 'Hi, can I book Saturday?' }),
    )
    expect(res.status).toBe(200)
    expect(sb.updatedMessages).toEqual([{ body: 'Voicemail: "Hi, can I book Saturday?"' }])
    expect(draftShadowReply).toHaveBeenCalledWith('convo-1', 'msg-1')
  })

  it('records a fallback note when transcription fails, without calling Ghost', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ CallSid: 'CA123', TranscriptionStatus: 'failed' }))
    expect(res.status).toBe(200)
    expect(sb.updatedMessages).toEqual([{ body: 'Voicemail left (transcription unavailable)' }])
    expect(draftShadowReply).not.toHaveBeenCalled()
  })

  it('saves the recording URL on a plain recording-ready callback (no transcription)', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ CallSid: 'CA123', RecordingUrl: 'https://api.twilio.com/recordings/RE123' }))
    expect(res.status).toBe(200)
    expect(sb.updatedMessages).toEqual([{ recording_url: 'https://api.twilio.com/recordings/RE123' }])
    expect(draftShadowReply).not.toHaveBeenCalled()
  })

  it('returns 403 and skips DB writes on an invalid signature', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(false)

    const res = await POST(makeReq({ CallSid: 'CA123', RecordingUrl: 'https://api.twilio.com/recordings/RE123' }))
    expect(res.status).toBe(403)
    expect(sb.updatedMessages).toHaveLength(0)
  })

  it('no-ops gracefully when conversationId is missing', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ CallSid: 'CA123', RecordingUrl: 'https://x' }, null))
    expect(res.status).toBe(200)
    expect(sb.updatedMessages).toHaveLength(0)
  })
})
