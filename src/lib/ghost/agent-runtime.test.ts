import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the model client + usage meter so the agentic loop runs with scripted
// responses and no network. vitest hoists vi.mock above all imports.
vi.mock('@/lib/ai/clients', () => ({ getClaude: vi.fn(), CLAUDE_MODEL: 'claude-test', CLAUDE_DRAFTER_MODEL: 'claude-test' }))
vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: vi.fn().mockResolvedValue(undefined) }))

import { clampToolResult, previewToolResult, runAgenticLoop, type AgentTool } from './agent-runtime'
import { getClaude } from '@/lib/ai/clients'
import { recordAiUsage } from '@/lib/ai/usage'
import { compactAvailability } from './tools'
import {
  agentForKind,
  agentAutonomy,
  AUTONOMY_CEILING,
  AUTONOMY_LEVEL,
  autonomyForKind,
  GHOST_AGENTS,
  IRREVERSIBLE_KINDS,
  levelRank,
} from './agents'

describe('clampToolResult', () => {
  it('passes small results through as JSON', () => {
    expect(clampToolResult({ a: 1 })).toBe('{"a":1}')
  })

  it('truncates fat results with a steer-the-model hint', () => {
    const fat = { rows: Array.from({ length: 1000 }, (_, i) => `row-${i}`) }
    const clamped = clampToolResult(fat, 200)
    expect(clamped.length).toBeLessThan(300)
    expect(clamped).toContain('truncated')
    expect(clamped).toContain('query narrower')
  })

  it('survives circular structures', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(clampToolResult(circular)).toBe('[object Object]')
  })
})

describe('previewToolResult', () => {
  it('shortens long results for the step log', () => {
    const preview = previewToolResult({ text: 'x'.repeat(2000) }, 100)
    expect(preview.length).toBeLessThanOrEqual(101)
  })
})

describe('compactAvailability', () => {
  const listing = { slug: 's', title: 'Private Cruise', category: 'private', price_display: '€310' }

  it('reports unavailable when no listing has slots', () => {
    expect(compactAvailability([{ listing, availableSlots: [] }])).toEqual({
      available: false,
      note: 'Nothing available that day for that group size.',
    })
  })

  it('compacts listings to times + options', () => {
    const result = compactAvailability([
      {
        listing,
        availableSlots: [
          {
            startTime: '5pm',
            customerTypes: [{ name: 'Diana 2h', priceCents: 31000, durationMinutes: 120 }],
          },
        ],
      },
    ]) as { available: boolean; listings: { times: string[]; options?: { price_eur: number }[] }[] }
    expect(result.available).toBe(true)
    expect(result.listings[0].times).toEqual(['5pm'])
    expect(result.listings[0].options?.[0].price_eur).toBe(310)
  })

  it('caps times at 8 per listing (context discipline)', () => {
    const slots = Array.from({ length: 20 }, (_, i) => ({ startTime: `${i}h` }))
    const result = compactAvailability([{ listing, availableSlots: slots }]) as {
      listings: { times: string[] }[]
    }
    expect(result.listings[0].times).toHaveLength(8)
  })
})

describe('agent registry', () => {
  it('maps every kind to exactly one agent', () => {
    const allKinds = GHOST_AGENTS.flatMap(a => a.kinds)
    expect(new Set(allKinds).size).toBe(allKinds.length) // no kind owned twice
    expect(agentForKind('reply_draft')?.key).toBe('inbox')
    expect(agentForKind('booking_proposal')?.key).toBe('booking')
    expect(agentForKind('schedule_day')?.key).toBe('scheduling')
    expect(agentForKind('catering_order')?.key).toBe('catering')
    expect(agentForKind('nonexistent')).toBeNull()
  })

  it('has the ten agents of the operations fleet', () => {
    expect(GHOST_AGENTS.map(a => a.key)).toEqual([
      'inbox',
      'booking',
      'catering',
      'booking_correction',
      'cancellation',
      'scheduling',
      'maintenance',
      'storage',
      'operations',
      'ota',
    ])
  })
})

describe('autonomy ladder (the safety invariant)', () => {
  it('every kind operates at or below its ceiling', () => {
    for (const kind of Object.keys(AUTONOMY_LEVEL)) {
      expect(levelRank(AUTONOMY_LEVEL[kind])).toBeLessThanOrEqual(levelRank(AUTONOMY_CEILING[kind]))
    }
  })

  it('irreversible kinds are pinned to a dry_run ceiling — can NEVER auto-execute', () => {
    for (const kind of IRREVERSIBLE_KINDS) {
      expect(AUTONOMY_CEILING[kind]).toBe('dry_run')
      // current level also cannot exceed it
      expect(levelRank(AUTONOMY_LEVEL[kind])).toBeLessThanOrEqual(levelRank('dry_run'))
    }
  })

  it('booking is the irreversible money kind and sits at dry_run', () => {
    expect(IRREVERSIBLE_KINDS).toContain('booking_proposal')
    expect(autonomyForKind('booking_proposal')).toBe('dry_run')
  })

  it('agentAutonomy reports the booking agent at dry_run, inbox at propose', () => {
    const booking = GHOST_AGENTS.find(a => a.key === 'booking')!
    const inbox = GHOST_AGENTS.find(a => a.key === 'inbox')!
    expect(agentAutonomy(booking)).toBe('dry_run')
    expect(agentAutonomy(inbox)).toBe('propose')
  })

  it('levelRank orders the ladder correctly', () => {
    expect(levelRank('propose')).toBeLessThan(levelRank('dry_run'))
    expect(levelRank('dry_run')).toBeLessThan(levelRank('ask'))
    expect(levelRank('ask')).toBeLessThan(levelRank('auto'))
  })
})

// ── runAgenticLoop — the tool-use control flow (scripted fake Claude) ─────────

type Block = Record<string, unknown>
const textBlock = (text: string): Block => ({ type: 'text', text })
const toolUse = (name: string, input: Block = {}, id = `tu_${name}`): Block => ({ type: 'tool_use', id, name, input })

function aiResponse(content: Block[], opts: { stop_reason?: string; input?: number; output?: number } = {}) {
  const hasTool = content.some(b => b.type === 'tool_use')
  return {
    content,
    stop_reason: opts.stop_reason ?? (hasTool ? 'tool_use' : 'end_turn'),
    usage: { input_tokens: opts.input ?? 10, output_tokens: opts.output ?? 5 },
  }
}

/** Fake Claude returning scripted responses in order. Returns the create spy. */
function scriptClaude(responses: unknown[]) {
  const create = vi.fn()
  responses.forEach(r => create.mockResolvedValueOnce(r))
  vi.mocked(getClaude).mockReturnValue({ messages: { create } } as never)
  return create
}

/** Fake Claude that always returns the same response (for cap/loop tests). */
function loopingClaude(response: unknown) {
  const create = vi.fn().mockResolvedValue(response)
  vi.mocked(getClaude).mockReturnValue({ messages: { create } } as never)
  return create
}

function tool(name: string, run = vi.fn().mockResolvedValue({ ok: true })): AgentTool {
  return { name, description: `desc:${name}`, input_schema: { type: 'object', properties: {} }, run }
}

const SUBMIT = { name: 'submit_reply', description: 'submit the reply', input_schema: { type: 'object' as const, properties: {} } }

function run(extra: Partial<Parameters<typeof runAgenticLoop>[0]> = {}) {
  return runAgenticLoop({
    feature: 'ghost_test',
    system: 'sys',
    prompt: 'do the thing',
    tools: [tool('search')],
    submitTools: [SUBMIT],
    ...extra,
  })
}

/** The loop reuses one `messages` array, so collect tool_results from the final state. */
function collectToolResults(create: ReturnType<typeof vi.fn>): Block[] {
  const messages = create.mock.calls.at(-1)![0].messages as { content: unknown }[]
  return messages.flatMap(m =>
    Array.isArray(m.content) ? (m.content as Block[]).filter(c => c.type === 'tool_result') : [],
  )
}

describe('runAgenticLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(recordAiUsage).mockResolvedValue(undefined)
  })

  it('a submit_* tool call ends the run and returns its input + submittedVia', async () => {
    scriptClaude([aiResponse([toolUse('submit_reply', { reply: 'hoi' })])])
    const res = await run()
    expect(res).not.toBeNull()
    expect(res!.submission).toEqual({ reply: 'hoi' })
    expect(res!.submittedVia).toBe('submit_reply')
    expect(res!.turns).toBe(1)
    expect(res!.steps).toEqual([])
  })

  it('executes read-only tools, feeds results back, and accumulates steps in order', async () => {
    const searchRun = vi.fn().mockResolvedValue({ slots: 3 })
    const bookingsRun = vi.fn().mockResolvedValue({ bookings: [] })
    const create = scriptClaude([
      aiResponse([toolUse('search', { date: '2026-06-20' }, 'id1')]),
      aiResponse([toolUse('get_bookings', { email: 'a@b.c' }, 'id2')]),
      aiResponse([toolUse('submit_reply', { reply: 'done' })]),
    ])
    const res = await run({ tools: [tool('search', searchRun), tool('get_bookings', bookingsRun)] })

    expect(searchRun).toHaveBeenCalledWith({ date: '2026-06-20' })
    expect(bookingsRun).toHaveBeenCalledWith({ email: 'a@b.c' })
    expect(res!.steps.map(s => s.tool)).toEqual(['search', 'get_bookings'])
    expect(res!.steps[0].input).toEqual({ date: '2026-06-20' })

    // Both tool results were fed back, in order, marked not-error.
    const results = collectToolResults(create)
    expect(results.map(r => r.tool_use_id)).toEqual(['id1', 'id2'])
    expect(results[0]).toMatchObject({ type: 'tool_result', is_error: false })
    expect(results[0].content).toContain('"slots":3')
  })

  it('returns null when MAX_TURNS is hit without a submit', async () => {
    const create = loopingClaude(aiResponse([toolUse('search', {})]))
    const res = await run({ maxTurns: 2 })
    expect(res).toBeNull()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('forces tool_choice to {type:"any"} on the final turn', async () => {
    const create = loopingClaude(aiResponse([toolUse('search', {})]))
    await run({ maxTurns: 2 })
    expect(create.mock.calls[0][0].tool_choice).toEqual({ type: 'auto' })
    expect(create.mock.calls[1][0].tool_choice).toEqual({ type: 'any' })
  })

  it('feeds back is_error for an unknown tool and keeps going', async () => {
    const create = scriptClaude([
      aiResponse([toolUse('nonexistent', {}, 'idX')]),
      aiResponse([toolUse('submit_reply', { reply: 'ok' })]),
    ])
    const res = await run()
    expect(res!.submittedVia).toBe('submit_reply') // loop continued past the bad tool
    expect(res!.steps).toEqual([]) // unknown tool is not recorded as a real step
    const results = collectToolResults(create)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ tool_use_id: 'idX', is_error: true })
    expect(results[0].content).toContain("Unknown tool 'nonexistent'")
  })

  it('feeds back is_error when a tool throws, records the step, and keeps going', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('boom'))
    const create = scriptClaude([
      aiResponse([toolUse('search', {}, 'idT')]),
      aiResponse([toolUse('submit_reply', { reply: 'ok' })]),
    ])
    const res = await run({ tools: [tool('search', boom)] })
    expect(res!.submittedVia).toBe('submit_reply')
    expect(res!.steps.map(s => s.tool)).toEqual(['search'])
    expect(res!.steps[0].result_preview).toContain('Tool error: boom')
    const results = collectToolResults(create)
    expect(results[0]).toMatchObject({ is_error: true })
    expect(results[0].content).toContain('Tool error: boom')
  })

  it('nudges once on an end_turn with no tool use, then returns null', async () => {
    const create = loopingClaude(aiResponse([textBlock('thinking out loud')], { stop_reason: 'end_turn' }))
    const res = await run({ maxTurns: 2 })
    expect(res).toBeNull()
    expect(create).toHaveBeenCalledTimes(2)
    const messages = create.mock.calls.at(-1)![0].messages
    expect(messages.at(-1)).toMatchObject({ role: 'user' })
    expect(messages.at(-1).content).toContain('Finish by calling one of the submit tools')
  })

  it('returns null immediately on a no-tool response that is not end_turn', async () => {
    const create = scriptClaude([aiResponse([textBlock('x')], { stop_reason: 'max_tokens' })])
    const res = await run()
    expect(res).toBeNull()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('meters usage exactly once per turn via recordAiUsage', async () => {
    scriptClaude([
      aiResponse([toolUse('search', {})], { input: 100, output: 20 }),
      aiResponse([toolUse('submit_reply', { reply: 'x' })], { input: 50, output: 8 }),
    ])
    await run()
    expect(recordAiUsage).toHaveBeenCalledTimes(2)
    expect(recordAiUsage).toHaveBeenNthCalledWith(1, { feature: 'ghost_test', model: 'claude-test', inputTokens: 100, outputTokens: 20 })
    expect(recordAiUsage).toHaveBeenNthCalledWith(2, { feature: 'ghost_test', model: 'claude-test', inputTokens: 50, outputTokens: 8 })
  })

  it('never throws — a model error returns null', async () => {
    const create = vi.fn().mockRejectedValue(new Error('api down'))
    vi.mocked(getClaude).mockReturnValue({ messages: { create } } as never)
    await expect(run()).resolves.toBeNull()
  })
})
