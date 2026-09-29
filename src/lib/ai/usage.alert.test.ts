import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ postSlackOps: vi.fn(), insertError: null as null | { message: string } }))

vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))
vi.mock('@/lib/ai/clients', () => ({ getClaude: vi.fn(), CLAUDE_MODEL: 'claude-sonnet-4-6' }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: async () => ({ error: h.insertError }) }),
    rpc: async () => ({ data: 500.5 }), // just past €5, and this ~0.9¢ call is what crossed it
  }),
}))

import { recordAiUsage } from './usage'

describe('recordAiUsage spend alert', () => {
  beforeEach(() => { h.postSlackOps.mockClear(); h.insertError = null })

  it("sends the €5 alert to Beer's DM via postSlackOps (never a hardcoded channel id)", async () => {
    await recordAiUsage({ feature: 'test_feature', model: 'claude-haiku-4-5', inputTokens: 10_000, outputTokens: 100 })
    expect(h.postSlackOps).toHaveBeenCalledTimes(1)
    expect(h.postSlackOps.mock.calls[0][0]).toContain('passed €5')
    expect(h.postSlackOps.mock.calls[0][0]).toContain('test_feature')
  })

  it('stays silent when another call already claimed the threshold', async () => {
    h.insertError = { message: 'duplicate key' }
    await recordAiUsage({ feature: 'test_feature', model: 'claude-haiku-4-5', inputTokens: 10_000, outputTokens: 100 })
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })
})
