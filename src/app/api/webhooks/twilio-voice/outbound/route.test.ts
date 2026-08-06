import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio/verify-signature', () => ({ verifyTwilioSignature: vi.fn() }))
vi.mock('@/lib/twilio/inbox-match', () => ({
  findOrCreateContactByPhone: vi.fn().mockResolvedValue('contact-1'),
  findOrCreateConversationByContact: vi.fn().mockResolvedValue({ id: 'convo-1' }),
}))
vi.mock('@/lib/webhooks/log', () => ({ logWebhookEvent: vi.fn().mockResolvedValue(undefined) }))

import { POST } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'

function makeReq(params: Record<string, string>, signature: string | null = 'valid-sig') {
  const formData = new Map(Object.entries(params))
  return {
    formData: async () => formData,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-twilio-signature' ? signature : null) },
    nextUrl: { pathname: '/api/webhooks/twilio-voice/outbound', search: '', searchParams: new URLSearchParams() },
  } as never
}

function makeSupabase() {
  const insertedMessages: Array<Record<string, unknown>> = []
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      insert: (payload: Record<string, unknown>) => {
        if (table === 'messages') insertedMessages.push(payload)
        return builder
      },
      update: () => builder,
      eq: () => builder,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return builder
  })
  return { client: { from }, insertedMessages }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.TWILIO_AUTH_TOKEN = 'test-token'
  process.env.TWILIO_VOICE_NUMBER = '+3197006532242'
})

describe('POST /api/webhooks/twilio-voice/outbound', () => {
  it('dials the requested number with the configured caller id', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ To: '+31612345678', CallSid: 'CA123' }))
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('<Number>+31612345678</Number>')
    expect(body).toContain('callerId="+3197006532242"')
    expect(sb.insertedMessages).toEqual([
      expect.objectContaining({ direction: 'out', body: 'Outbound call to +31612345678' }),
    ])
  })

  it('rejects a To value that is not phone-number-shaped, instead of dropping it into TwiML unescaped', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    // A value crafted to break out of the <Number> tag if it were interpolated raw.
    const malicious = '+31612345678</Number><Number>+19995551234'
    const res = await POST(makeReq({ To: malicious, CallSid: 'CA123' }))
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).not.toContain('</Number><Number>')
    expect(body).toContain('not a valid phone number')
    expect(sb.insertedMessages).toHaveLength(0)
  })

  it('escapes XML special characters in To even when otherwise phone-shaped enough to slip through partial validation', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ To: '+31612345678"><Say>hacked</Say>', CallSid: 'CA123' }))
    const body = await res.text()

    // Rejected by the phone-number pattern before it ever reaches XML interpolation.
    expect(body).not.toContain('<Say>hacked</Say>')
  })

  it('returns 403 and does not dial on an invalid signature', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(false)

    const res = await POST(makeReq({ To: '+31612345678', CallSid: 'CA123' }))
    expect(res.status).toBe(403)
    expect(sb.insertedMessages).toHaveLength(0)
  })

  it('says sorry when To or CallSid is missing, without dialing', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ CallSid: 'CA123' }))
    const body = await res.text()
    expect(body).toContain('no number was given')
    expect(sb.insertedMessages).toHaveLength(0)
  })

  it('says outbound calling is not configured when TWILIO_VOICE_NUMBER is unset', async () => {
    delete process.env.TWILIO_VOICE_NUMBER
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ To: '+31612345678', CallSid: 'CA123' }))
    const body = await res.text()
    expect(body).toContain('not configured yet')
  })

  it('still dials even if logging the call to the DB fails (the call matters more than the record)', async () => {
    const from = vi.fn(() => {
      const builder: Record<string, unknown> = {
        insert: () => ({ then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '500', message: 'db down' } }).then(r) }),
        update: () => builder,
        eq: () => builder,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      }
      return builder
    })
    vi.mocked(createAdminClient).mockReturnValue({ from } as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ To: '+31612345678', CallSid: 'CA123' }))
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).toContain('<Number>+31612345678</Number>')
  })
})
