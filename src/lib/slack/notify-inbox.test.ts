import { describe, it, expect, vi, beforeEach } from 'vitest'

const postSlackDM = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('./send-notification', () => ({ postSlackDM }))

import { buildInboxSlackText, conversationUrl, notifyInboxItem } from './notify-inbox'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test'
})

describe('conversationUrl', () => {
  it('deep-links to the thread itself, not just the inbox list', () => {
    expect(conversationUrl('conv-1')).toBe('https://example.test/en/admin/inbox?c=conv-1')
  })
})

describe('buildInboxSlackText', () => {
  it('leads with the headline and sender, and always ends with the admin link', () => {
    const text = buildInboxSlackText({ conversationId: 'conv-1', from: 'Jacob', headline: 'New message' })
    expect(text.split('\n')[0]).toBe('*New message* — Jacob')
    expect(text).toContain('<https://example.test/en/admin/inbox?c=conv-1|Open in admin →>')
  })

  it('quotes the draft so it reads as the proposed reply, not as Beer being spoken to', () => {
    const text = buildInboxSlackText({
      conversationId: 'c',
      from: 'Jacob',
      headline: 'New message',
      draft: 'Hey Jacob,\nSaturday needs one more guest.',
    })
    expect(text).toContain('> Hey Jacob,\n> Saturday needs one more guest.')
  })

  it('drops empty detail lines rather than printing blanks', () => {
    const text = buildInboxSlackText({
      conversationId: 'c',
      from: 'GetYourGuide',
      headline: 'Booking not in our database yet',
      details: ['Shared Cruise', null, undefined, '2 guests'],
    })
    expect(text).toContain('Shared Cruise')
    expect(text).toContain('2 guests')
    expect(text).not.toMatch(/\n\s*(null|undefined)\s*\n/)
  })

  it('truncates a very long draft so the DM stays glanceable', () => {
    const text = buildInboxSlackText({ conversationId: 'c', from: 'X', headline: 'New message', draft: 'a'.repeat(900) })
    expect(text).toContain('…')
    expect(text.length).toBeLessThan(900)
  })
})

describe('notifyInboxItem', () => {
  it('sends to Beer’s DM (postSlackDM), never the shared channel webhook', async () => {
    await notifyInboxItem({ conversationId: 'conv-1', from: 'Jacob', headline: 'New message' })
    expect(postSlackDM).toHaveBeenCalledTimes(1)
    expect(postSlackDM.mock.calls[0][0]).toContain('*New message* — Jacob')
  })

  it('never throws — a Slack outage must not break email ingestion', async () => {
    postSlackDM.mockRejectedValueOnce(new Error('slack down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifyInboxItem({ conversationId: 'c', from: 'X', headline: 'New message' })).resolves.toBeUndefined()
  })
})
