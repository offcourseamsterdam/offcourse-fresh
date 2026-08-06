import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio/verify-signature', () => ({ verifyTwilioSignature: vi.fn() }))
vi.mock('@/lib/webhooks/log', () => ({ logWebhookEvent: vi.fn().mockResolvedValue(undefined) }))

import { POST } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'

function makeReq(params: Record<string, string>, conversationId: string | null = 'convo-1', signature: string | null = 'valid-sig') {
  const formData = new Map(Object.entries(params))
  const search = conversationId ? `?conversationId=${conversationId}` : ''
  return {
    formData: async () => formData,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-twilio-signature' ? signature : null) },
    nextUrl: {
      pathname: '/api/webhooks/twilio-voice/status',
      search,
      searchParams: new URLSearchParams(search),
    },
  } as never
}

function makeSupabase() {
  const updatedMessages: Array<Record<string, unknown>> = []
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {
      update: (payload: Record<string, unknown>) => {
        updatedMessages.push(payload)
        return builder
      },
      eq: () => builder,
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

describe('POST /api/webhooks/twilio-voice/status', () => {
  it('logs the call duration when the dial completed (someone answered)', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ CallSid: 'CA123', DialCallStatus: 'completed', DialCallDuration: '95' }))
    expect(res.status).toBe(200)
    expect(sb.updatedMessages).toEqual([{ body: 'Call answered (95s)' }])
  })

  it('returns a voicemail prompt when no one answered', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ CallSid: 'CA123', DialCallStatus: 'no-answer' }))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<Say>')
    expect(body).toContain('<Record')
    expect(body).toContain('transcribe="true"')
    expect(sb.updatedMessages).toEqual([{ body: 'Missed call — leaving a voicemail' }])
  })

  it.each(['busy', 'failed', 'canceled'])('also falls back to voicemail on DialCallStatus=%s', async status => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ CallSid: 'CA123', DialCallStatus: status }))
    const body = await res.text()
    expect(body).toContain('<Record')
  })

  it('returns 403 and skips DB writes on an invalid signature', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(false)

    const res = await POST(makeReq({ CallSid: 'CA123', DialCallStatus: 'completed' }))
    expect(res.status).toBe(403)
    expect(sb.updatedMessages).toHaveLength(0)
  })

  it('responds gracefully when conversationId is missing from the URL', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ CallSid: 'CA123', DialCallStatus: 'completed' }, null))
    expect(res.status).toBe(200)
    expect(sb.updatedMessages).toHaveLength(0)
  })
})
