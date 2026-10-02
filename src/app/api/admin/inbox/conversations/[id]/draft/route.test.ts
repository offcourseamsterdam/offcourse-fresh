import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  draftShadowReply: vi.fn(),
  conversation: { data: { id: 'c1' } as { id: string } | null, error: null as { message: string } | null },
  lastInbound: { data: { id: 'm9' } as { id: string } | null },
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/chat/shadow-drafter', () => ({ draftShadowReply: h.draftShadowReply }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = table === 'conversations' ? h.conversation : h.lastInbound
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
      chain.maybeSingle = () => Promise.resolve(result)
      return chain
    },
  }),
}))

import { POST } from './route'

const call = () => POST(new Request('http://x') as never, { params: Promise.resolve({ id: 'c1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  h.conversation.data = { id: 'c1' }
  h.conversation.error = null
  h.lastInbound.data = { id: 'm9' }
  h.draftShadowReply.mockResolvedValue({ kind: 'reply_draft' })
})

describe('POST /api/admin/inbox/conversations/[id]/draft', () => {
  it('drafts against the newest inbound message', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(h.draftShadowReply).toHaveBeenCalledWith('c1', 'm9')
  })

  it('refuses without admin and never calls the paid agent', async () => {
    h.requireAdmin.mockResolvedValue(new Response('no', { status: 401 }))
    const res = await call()
    expect(res.status).toBe(401)
    expect(h.draftShadowReply).not.toHaveBeenCalled()
  })

  it('404s on an unknown conversation', async () => {
    h.conversation.data = null
    expect((await call()).status).toBe(404)
    expect(h.draftShadowReply).not.toHaveBeenCalled()
  })

  it('400s when the thread has no inbound message', async () => {
    h.lastInbound.data = null
    expect((await call()).status).toBe(400)
  })

  it('422s when Ghost produced nothing', async () => {
    h.draftShadowReply.mockResolvedValue(null)
    expect((await call()).status).toBe(422)
  })
})
