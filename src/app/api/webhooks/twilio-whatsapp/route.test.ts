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
import { logWebhookEvent } from '@/lib/webhooks/log'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'

const PARAMS = {
  From: 'whatsapp:+31612345678',
  To: 'whatsapp:+14155238886',
  Body: 'Hi, do you have a slot Saturday?',
  MessageSid: 'SM123',
  ProfileName: 'Susanne Hartmann',
}

function makeReq(params: Record<string, string> = PARAMS, signature: string | null = 'valid-sig') {
  const formData = new Map(Object.entries(params))
  return {
    formData: async () => formData,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-twilio-signature' ? signature : null) },
  } as never
}

/** Route-shaped Supabase stub covering contacts/conversations/messages. */
function makeSupabase({
  existingContact,
  existingConversation,
  insertMessageError,
  windowUpdateError,
}: {
  existingContact?: { id: string; name: string } | null
  existingConversation?: { id: string; unread_count: number } | null
  insertMessageError?: { code: string; message: string } | null
  windowUpdateError?: { message: string } | null
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
        if (table === 'contacts') return { data: { id: 'contact-1' }, error: null }
        if (table === 'conversations') return { data: { id: 'convo-1' }, error: null }
        if (table === 'messages') {
          if (insertMessageError) return { data: null, error: insertMessageError }
          return { data: { id: 'msg-1' }, error: null }
        }
        return { data: null, error: null }
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: table === 'conversations' ? (windowUpdateError ?? null) : null }).then(resolve),
    }
    return builder
  })

  return { client: { from }, inserted, updated }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/webhooks/twilio-whatsapp — happy path', () => {
  it('creates a contact + conversation, saves the message, and drafts a reply', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<Response/>')

    expect(sb.inserted.contacts).toEqual([{ name: 'Susanne Hartmann', phone_e164: '+31612345678' }])
    expect(sb.inserted.conversations).toEqual([{ channel: 'whatsapp', contact_id: 'contact-1' }])
    expect(sb.inserted.messages).toEqual([
      {
        conversation_id: 'convo-1',
        direction: 'in',
        body: 'Hi, do you have a slot Saturday?',
        author_name: 'Susanne Hartmann',
        provider: 'twilio_whatsapp',
        provider_message_id: 'SM123',
      },
    ])
    expect(draftShadowReply).toHaveBeenCalledWith('convo-1', 'msg-1')
    expect(logWebhookEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ signatureValid: true, processed: true }))
  })

  it('reuses an existing contact and conversation instead of creating new ones', async () => {
    const sb = makeSupabase({
      existingContact: { id: 'contact-9', name: 'Susanne Hartmann' },
      existingConversation: { id: 'convo-9', unread_count: 2 },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    await POST(makeReq())
    expect(sb.inserted.contacts).toHaveLength(0)
    expect(sb.inserted.conversations).toHaveLength(0)
    expect(sb.updated.conversations).toEqual([
      { last_message_at: expect.any(String), unread_count: 3, status: 'open', wa_window_expires_at: expect.any(String) },
    ])
  })

  it('sets wa_window_expires_at to ~24h from now on every inbound message', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const before = Date.now()
    await POST(makeReq())
    const after = Date.now()

    const updatePayload = sb.updated.conversations[0] as Record<string, unknown>
    const expiresAt = new Date(updatePayload.wa_window_expires_at as string).getTime()
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
    expect(expiresAt).toBeGreaterThanOrEqual(before + TWENTY_FOUR_HOURS_MS)
    expect(expiresAt).toBeLessThanOrEqual(after + TWENTY_FOUR_HOURS_MS)
  })
})

describe('POST /api/webhooks/twilio-whatsapp — guards', () => {
  it('returns 403 and never touches the DB on an invalid signature', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(false)

    const res = await POST(makeReq())
    expect(res.status).toBe(403)
    expect(sb.inserted.contacts).toHaveLength(0)
    expect(draftShadowReply).not.toHaveBeenCalled()
    expect(logWebhookEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ signatureValid: false }))
  })

  it('returns 400 when From or MessageSid is missing', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq({ ...PARAMS, MessageSid: '' }))
    expect(res.status).toBe(400)
    expect(draftShadowReply).not.toHaveBeenCalled()
  })

  it('returns 200 (no double-draft) on a duplicate MessageSid', async () => {
    const sb = makeSupabase({ insertMessageError: { code: '23505', message: 'duplicate key' } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(draftShadowReply).not.toHaveBeenCalled()
    expect(logWebhookEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ error: 'duplicate (already ingested)' }))
  })

  it('returns 500 (so Twilio retries) on an unexpected DB error', async () => {
    const sb = makeSupabase({ insertMessageError: { code: '99999', message: 'db is down' } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(500)
    expect(draftShadowReply).not.toHaveBeenCalled()
  })

  it('returns 500 instead of a false-positive 200 when the window-reopen update fails', async () => {
    const sb = makeSupabase({ windowUpdateError: { message: 'row-level security violation' } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(verifyTwilioSignature).mockReturnValue(true)

    const res = await POST(makeReq())
    expect(res.status).toBe(500)
    // The message itself was already saved before this failure — only the
    // window-reopen (and the deferred reply draft that depends on it landing
    // cleanly) is affected.
    expect(sb.inserted.messages).toHaveLength(1)
    expect(logWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ error: expect.stringContaining('row-level security violation') }),
    )
  })
})
