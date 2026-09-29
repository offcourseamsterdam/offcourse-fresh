import { describe, it, expect, vi, beforeEach } from 'vitest'

const draftShadowReply = vi.hoisted(() => vi.fn())
const notifyInboxItem = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('./shadow-drafter', () => ({ draftShadowReply }))
vi.mock('@/lib/slack/notify-inbox', async () => ({
  ...(await vi.importActual<typeof import('@/lib/slack/notify-inbox')>('@/lib/slack/notify-inbox')),
  notifyInboxItem,
}))

import { draftAndNotify } from './draft-and-notify'

const base = { conversationId: 'c1', messageId: 'm1', from: 'Jacob', via: 'via WhatsApp' }

beforeEach(() => vi.clearAllMocks())

describe('draftAndNotify', () => {
  it('pings with the draft when Ghost wrote a plain reply', async () => {
    draftShadowReply.mockResolvedValue({ kind: 'reply_draft', reasoning: 'r', reply: 'Hi Jacob' })
    await draftAndNotify(base)
    expect(notifyInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ headline: 'New message', draft: 'Hi Jacob', action: undefined }),
    )
  })

  it('asks for approval when Ghost proposed an action', async () => {
    draftShadowReply.mockResolvedValue({ kind: 'cancellation_request', reasoning: 'r', reply: 'ok' })
    await draftAndNotify(base)
    expect(notifyInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ headline: 'New message — CANCELLATION requested', action: expect.stringContaining('approval') }),
    )
  })

  it('still pings Beer when Ghost returns nothing', async () => {
    draftShadowReply.mockResolvedValue(null)
    await draftAndNotify(base)
    expect(notifyInboxItem).toHaveBeenCalledTimes(1)
    expect(notifyInboxItem.mock.calls[0][0].details.join(' ')).toContain('could not draft')
  })

  it('never throws, even if Ghost blows up', async () => {
    draftShadowReply.mockRejectedValue(new Error('boom'))
    await expect(draftAndNotify(base)).resolves.toBeUndefined()
  })
})
