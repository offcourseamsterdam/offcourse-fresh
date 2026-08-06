import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  getUserProfile: vi.fn().mockResolvedValue({ display_name: 'Beer' }),
  sendGmailReply: vi.fn(),
  sendWhatsappMessage: vi.fn(),
  conversation: null as Record<string, unknown> | null,
  contact: null as Record<string, unknown> | null,
  lastInbound: null as Record<string, unknown> | null,
  insertedMessage: null as Record<string, unknown> | null,
  insertError: null as Record<string, unknown> | null,
  insertedPayload: null as Record<string, unknown> | null,
  conversationUpdatePayload: null as Record<string, unknown> | null,
  openDraft: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/auth/server', () => ({ getUserProfile: h.getUserProfile }))
vi.mock('@/lib/gmail/client', () => ({ sendReply: h.sendGmailReply }))
vi.mock('@/lib/whatsapp/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/client')>()
  return { ...actual, sendWhatsappMessage: h.sendWhatsappMessage }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.conversation }) }) }),
          update: (payload: Record<string, unknown>) => {
            h.conversationUpdatePayload = payload
            return { eq: async () => ({ data: null, error: null }) }
          },
        }
      }
      if (table === 'contacts') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.contact }) }) }) }
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                not: () => ({
                  order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: h.lastInbound }) }) }),
                }),
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => {
            h.insertedPayload = payload
            return {
              select: () => ({
                single: async () => ({ data: h.insertedMessage, error: h.insertError }),
              }),
            }
          },
        }
      }
      if (table === 'agent_proposals') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                is: () => ({
                  order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: h.openDraft }) }) }),
                }),
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

import { POST } from './route'

function mockReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  h.getUserProfile.mockResolvedValue({ display_name: 'Beer' })
  h.conversation = { id: 'c1', status: 'open', channel: 'webchat', provider_thread_id: null, subject: 'Hi', contact_id: 'contact-1' }
  h.contact = { email: 'jane@example.com' }
  h.lastInbound = { provider_message_id: 'gmail-in-1' }
  h.insertedMessage = { id: 'm1', direction: 'out', body: 'hello', author_name: 'Beer', status: 'sent', error: null, created_at: 'now' }
  h.insertError = null
  h.insertedPayload = null
  h.conversationUpdatePayload = null
  h.openDraft = null
})

describe('POST inbox messages — webchat (regression guard)', () => {
  it('sends nothing externally and stores the row exactly as before', async () => {
    const res = await POST(mockReq({ direction: 'out', body: 'hello there' }), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(h.sendGmailReply).not.toHaveBeenCalled()
    expect(json.data.message.status).toBe('sent')
    expect(h.insertedPayload).not.toHaveProperty('provider')
    expect(h.insertedPayload).not.toHaveProperty('provider_message_id')
    expect(h.conversationUpdatePayload).toMatchObject({ status: 'pending' })
  })
})

describe('POST inbox messages — email channel', () => {
  beforeEach(() => {
    h.conversation = { id: 'c1', status: 'open', channel: 'email', provider_thread_id: 'thread-1', subject: 'Booking question', contact_id: 'contact-1' }
  })

  it('sends via Gmail with the right thread/recipient/In-Reply-To and stores the returned id', async () => {
    h.sendGmailReply.mockResolvedValue({ id: 'sent-abc' })

    const res = await POST(mockReq({ direction: 'out', body: 'Yes, Saturday works!' }), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(h.sendGmailReply).toHaveBeenCalledWith({
      threadId: 'thread-1',
      to: 'jane@example.com',
      subject: 'Booking question',
      body: 'Yes, Saturday works!',
      inReplyToMessageId: 'gmail-in-1',
    })
    expect(h.insertedPayload).toMatchObject({ provider: 'gmail', provider_message_id: 'sent-abc', status: 'sent' })
    expect(res.status).toBe(200)
    expect(json.data.message).toBeDefined()
    expect(h.conversationUpdatePayload).toMatchObject({ status: 'pending' })
  })

  it('marks the message failed and returns an error (not a silent 200) when the Gmail send throws', async () => {
    h.sendGmailReply.mockRejectedValue(new Error('Gmail API 500'))
    h.insertedMessage = { id: 'm1', direction: 'out', body: 'x', author_name: 'Beer', status: 'failed', error: 'Gmail API 500', created_at: 'now' }

    const res = await POST(mockReq({ direction: 'out', body: 'x' }), { params: Promise.resolve({ id: 'c1' }) })

    expect(res.status).toBe(502)
    expect(h.insertedPayload).toMatchObject({ status: 'failed', error: 'Gmail API 500' })
    // Failed send must not flip the conversation to "pending" — nothing was delivered.
    expect(h.conversationUpdatePayload).toBeNull()
  })

  it('fails closed when the contact has no email on file', async () => {
    h.contact = { email: null }

    const res = await POST(mockReq({ direction: 'out', body: 'x' }), { params: Promise.resolve({ id: 'c1' }) })

    expect(h.sendGmailReply).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
    expect(h.insertedPayload).toMatchObject({ status: 'failed' })
  })

  it('does not attempt to send for an internal note on an email conversation', async () => {
    const res = await POST(mockReq({ direction: 'note', body: 'regular customer' }), { params: Promise.resolve({ id: 'c1' }) })

    expect(h.sendGmailReply).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })
})

describe('POST inbox messages — whatsapp channel', () => {
  beforeEach(() => {
    h.conversation = { id: 'c1', status: 'open', channel: 'whatsapp', provider_thread_id: null, subject: null, contact_id: 'contact-1' }
    h.contact = { phone_e164: '+31612345678' }
  })

  it('sends via Twilio WhatsApp and stores the returned message id', async () => {
    h.sendWhatsappMessage.mockResolvedValue({ id: 'SM999' })

    const res = await POST(mockReq({ direction: 'out', body: 'Yes, Saturday works!' }), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(h.sendWhatsappMessage).toHaveBeenCalledWith({ to: '+31612345678', body: 'Yes, Saturday works!' })
    expect(h.insertedPayload).toMatchObject({ provider: 'twilio_whatsapp', provider_message_id: 'SM999', status: 'sent' })
    expect(res.status).toBe(200)
    expect(json.data.message).toBeDefined()
    expect(h.conversationUpdatePayload).toMatchObject({ status: 'pending' })
  })

  it('surfaces the 24h-window closure as an explainable error, not a bare Twilio code', async () => {
    const { WhatsappWindowClosedError } = await import('@/lib/whatsapp/client')
    h.sendWhatsappMessage.mockRejectedValue(new WhatsappWindowClosedError())
    h.insertedMessage = { id: 'm1', direction: 'out', body: 'x', author_name: 'Beer', status: 'failed', error: 'window closed', created_at: 'now' }

    const res = await POST(mockReq({ direction: 'out', body: 'x' }), { params: Promise.resolve({ id: 'c1' }) })
    const json = await res.json()

    expect(res.status).toBe(502)
    expect(json.error).toContain('24-hour WhatsApp session window')
    expect(h.insertedPayload).toMatchObject({ status: 'failed' })
    expect(h.conversationUpdatePayload).toBeNull()
  })

  it('fails closed when the contact has no phone number on file', async () => {
    h.contact = { phone_e164: null }

    const res = await POST(mockReq({ direction: 'out', body: 'x' }), { params: Promise.resolve({ id: 'c1' }) })

    expect(h.sendWhatsappMessage).not.toHaveBeenCalled()
    expect(res.status).toBe(502)
    expect(h.insertedPayload).toMatchObject({ status: 'failed' })
  })

  it('does not attempt to send for an internal note on a whatsapp conversation', async () => {
    const res = await POST(mockReq({ direction: 'note', body: 'regular customer' }), { params: Promise.resolve({ id: 'c1' }) })

    expect(h.sendWhatsappMessage).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })
})
