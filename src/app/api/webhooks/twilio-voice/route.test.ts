import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio/verify-signature', () => ({ verifyTwilioSignature: vi.fn() }))
vi.mock('@/lib/webhooks/log', () => ({ logWebhookEvent: vi.fn().mockResolvedValue(undefined) }))

import { POST } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'
import { logWebhookEvent } from '@/lib/webhooks/log'

const ENV_BACKUP = { ...process.env }

const PARAMS = {
  From: '+31612345678',
  To: '+14155238886',
  CallSid: 'CA123',
  CallerName: 'Susanne Hartmann',
}

function makeReq(params: Record<string, string> = PARAMS, signature: string | null = 'valid-sig') {
  const formData = new Map(Object.entries(params))
  return {
    formData: async () => formData,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-twilio-signature' ? signature : null) },
    nextUrl: { pathname: '/api/webhooks/twilio-voice', search: '' },
  } as never
}

function makeSupabase({
  existingContact,
  existingConversation,
  insertMessageError,
  insertContactError,
}: {
  existingContact?: { id: string; name: string } | null
  existingConversation?: { id: string; unread_count: number } | null
  insertMessageError?: { code: string; message: string } | null
  insertContactError?: { message: string } | null
} = {}) {
  const inserted: Record<string, unknown[]> = { contacts: [], conversations: [], messages: [] }
  const updated: Record<string, unknown[]> = { contacts: [], conversations: [] }

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        if (table === 'contacts') return { data: existingContact ?? null }
        if (table === 'conversations') return { data: existingConversation ?? null }
        return { data: null }
      },
      insert: (payload: Record<string, unknown>) => {
        inserted[table]?.push(payload)
        return builder
      },
      update: (payload: Record<string, unknown>) => {
        updated[table]?.push(payload)
        return builder
      },
      single: async () => {
        if (table === 'contacts') return insertContactError ? { data: null, error: insertContactError } : { data: { id: 'contact-1' }, error: null }
        if (table === 'conversations') return { data: { id: 'convo-1' }, error: null }
        return { data: null, error: null }
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'messages') return Promise.resolve({ error: insertMessageError ?? null }).then(resolve)
        return Promise.resolve({ data: null, error: null }).then(resolve)
      },
    }
    return builder
  })

  return { client: { from }, inserted, updated }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.TWILIO_MY_PHONE_NUMBER = '+31600000000'
})

afterEach(() => {
  process.env = { ...ENV_BACKUP }
})

describe('POST /api/webhooks/twilio-voice — happy path', () => {
  it('logs the call and returns TwiML ringing the Client + configured phone', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<Client>beer</Client>')
    expect(body).toContain('<Number>+31600000000</Number>')
    expect(body).toContain('record="record-from-answer"')

    expect(sb.inserted.contacts).toEqual([{ name: 'Susanne Hartmann', phone_e164: '+31612345678' }])
    expect(sb.inserted.conversations).toEqual([{ channel: 'voice', contact_id: 'contact-1' }])
    expect(sb.inserted.messages).toEqual([
      {
        conversation_id: 'convo-1',
        direction: 'in',
        body: 'Incoming call',
        author_name: 'Susanne Hartmann',
        provider: 'twilio_voice',
        provider_message_id: 'CA123',
      },
    ])
    expect(logWebhookEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ signatureValid: true, processed: true }))
  })
})

describe('POST /api/webhooks/twilio-voice — guards', () => {
  it('returns 403 and never touches the DB on an invalid signature', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(false)

    const res = await POST(makeReq())
    expect(res.status).toBe(403)
    expect(sb.inserted.contacts).toHaveLength(0)
  })

  it('returns 400 when From or CallSid is missing', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ ...PARAMS, CallSid: '' }))
    expect(res.status).toBe(400)
  })

  it('rings nothing but responds gracefully when TWILIO_MY_PHONE_NUMBER is unset', async () => {
    delete process.env.TWILIO_MY_PHONE_NUMBER
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<Say>')
    expect(sb.inserted.contacts).toHaveLength(0) // never even tries to log the call
  })

  it('does not throw on a duplicate CallSid (Twilio retry) — still rings through', async () => {
    const sb = makeSupabase({ insertMessageError: { code: '23505', message: 'duplicate key' } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<Client>beer</Client>')
  })
})

describe('POST /api/webhooks/twilio-voice — error-path voicemail fallback', () => {
  it('still carries the full voicemail action/record attributes when the failure happens AFTER the conversation is known', async () => {
    // The conversation gets resolved before the message insert — which is
    // what then throws (a non-23505 DB error) — so the fallback TwiML must
    // still be able to fall through to voicemail on no answer, not just hang
    // up silently.
    const sb = makeSupabase({ insertMessageError: { code: '99999', message: 'db is down' } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<Client>beer</Client>')
    expect(body).toContain('record="record-from-answer"')
    expect(body).toContain('action="')
    expect(body).toContain('/api/webhooks/twilio-voice/status?conversationId=convo-1')
  })

  it('falls back to a bare Dial (no voicemail attributes) when the conversation itself could never be resolved', async () => {
    const sb = makeSupabase({ insertContactError: { message: 'db is down' } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<Client>beer</Client>')
    expect(body).not.toContain('record=')
    expect(body).not.toContain('action=')
  })
})
