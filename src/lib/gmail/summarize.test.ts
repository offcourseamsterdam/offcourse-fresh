import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ meteredMessage: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ meteredMessage: h.meteredMessage }))
vi.mock('@/lib/ai/clients', () => ({ CLAUDE_DRAFTER_MODEL: 'claude-test' }))

import { summarizeInboundEmail } from './summarize'

function toolResponse(input: Record<string, unknown>) {
  return { content: [{ type: 'tool_use', id: 't1', name: 'submit_summary', input }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('summarizeInboundEmail', () => {
  it('returns the summary together with the reply verdict and reason', async () => {
    h.meteredMessage.mockResolvedValue(toolResponse({ summary: ' Sat 2pm, 4 guests — asks about a dog ', needs_reply: 'yes', needs_reply_reason: 'Guest asks a question' }))
    expect(await summarizeInboundEmail({ subject: 'Dog?', bodyText: 'Can we bring our dog?', fromEmail: 'jane@gmail.com' })).toEqual({
      summary: 'Sat 2pm, 4 guests — asks about a dog',
      needsReply: 'yes',
      needsReplyReason: 'Guest asks a question',
    })
  })

  it('passes the sender to the model and keeps the call metered under the same feature tag', async () => {
    h.meteredMessage.mockResolvedValue(toolResponse({ summary: 'x', needs_reply: 'no' }))
    await summarizeInboundEmail({ subject: 'Receipt', bodyText: 'Paid', fromEmail: 'noreply@stripe.com' })
    const [feature, params] = h.meteredMessage.mock.calls[0]
    expect(feature).toBe('inbox_email_summary')
    expect(params.messages[0].content).toContain('FROM: noreply@stripe.com')
    expect(params.tools[0].input_schema.required).toEqual(['summary', 'needs_reply'])
  })

  it('treats an invalid verdict as "no answer" but keeps the summary', async () => {
    h.meteredMessage.mockResolvedValue(toolResponse({ summary: 'Receipt for €12', needs_reply: 'probably', needs_reply_reason: 'whatever' }))
    expect(await summarizeInboundEmail({ subject: 's', bodyText: 'b' })).toEqual({ summary: 'Receipt for €12', needsReply: null, needsReplyReason: null })
  })

  it('keeps a verdict even when the summary is empty', async () => {
    h.meteredMessage.mockResolvedValue(toolResponse({ summary: '  ', needs_reply: 'no' }))
    expect(await summarizeInboundEmail({ subject: 's', bodyText: 'b' })).toEqual({ summary: null, needsReply: 'no', needsReplyReason: null })
  })

  it('returns null when the model gave nothing usable', async () => {
    h.meteredMessage.mockResolvedValue(toolResponse({}))
    expect(await summarizeInboundEmail({ subject: 's', bodyText: 'b' })).toBeNull()
    h.meteredMessage.mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] })
    expect(await summarizeInboundEmail({ subject: 's', bodyText: 'b' })).toBeNull()
  })

  it('never throws — an API failure returns null so ingestion carries on', async () => {
    h.meteredMessage.mockRejectedValue(new Error('overloaded'))
    expect(await summarizeInboundEmail({ subject: 's', bodyText: 'b' })).toBeNull()
  })

  it('caps an over-long reason', async () => {
    h.meteredMessage.mockResolvedValue(toolResponse({ summary: 's', needs_reply: 'no', needs_reply_reason: 'x'.repeat(500) }))
    const result = await summarizeInboundEmail({ subject: 's', bodyText: 'b' })
    expect(result?.needsReplyReason).toHaveLength(120)
  })
})
