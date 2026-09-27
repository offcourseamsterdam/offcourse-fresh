/**
 * Inbox-agent reschedule prototype — real Claude, fake world.
 *
 * Runs the REAL inbox agent definition (system prompt, task prompt, tool
 * descriptions, submit actions from src/lib/chat/shadow-drafter.ts) plus the
 * PROPOSED reschedule additions (mock-tools.ts) against synthetic scenarios
 * (scenarios.ts). Every tool answers from made-up data.
 *
 * Opt-in; self-skips in `npm test`. Run it with:
 *   AGENT_PROTOTYPE=1 npx vitest run scripts/agent-prototype
 * Knobs: AGENT_PROTOTYPE_MODELS (comma list), AGENT_PROTOTYPE_RUNS (per
 * scenario), AGENT_PROTOTYPE_ONLY (scenario id prefix), AGENT_PROTOTYPE_OUT (dir).
 *
 * Safety, in layers:
 *  1. Only ANTHROPIC_API_KEY is read from .env.local, straight into the client.
 *     No other live key enters this process (vitest's setup uses placeholders).
 *  2. fetch is wrapped: any request to a host other than api.anthropic.com throws.
 *  3. Supabase, Slack, WhatsApp, Twilio, search and AI-usage modules are mocked to
 *     throw if anything calls them.
 *  4. Every tool's `run` is replaced by a mock before the model sees it.
 */
import { describe, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

const { blocked } = vi.hoisted(() => ({
  blocked: (what: string) => () => {
    throw new Error(`[agent-prototype] blocked call to ${what}`)
  },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: blocked('Supabase') }))
vi.mock('@/lib/slack/send-notification', () => ({
  postSlackText: blocked('Slack'), postSlackDM: blocked('Slack'), postSlackCritical: blocked('Slack'), postSlackOps: blocked('Slack'),
}))
vi.mock('@/lib/whatsapp/client', () => ({ sendWhatsappMessage: blocked('WhatsApp') }))
vi.mock('@/lib/twilio/client', () => ({ sendTwilioSms: blocked('Twilio'), normalizePhoneNumber: (p: string) => p }))
vi.mock('@/lib/search/fetch-search-results', () => ({ fetchSearchResults: blocked('FareHarbor search') }))
vi.mock('@/lib/ai/usage', () => ({
  recordAiUsage: blocked('ai_usage'), meteredMessage: blocked('ai_usage'), computeCostEurCents: () => 0, crossedThresholds: () => [], getAiSpendSummary: blocked('ai_usage'),
}))

import { buildGhostTools } from '@/lib/ghost/tools'
import { OFF_COURSE_SYSTEM_PROMPT } from '@/lib/ai/context'
import { INBOX_TOOL_NAMES, INBOX_SUBMIT_TOOLS, buildInboxAgentPrompt } from '@/lib/chat/shadow-drafter'
import { SCENARIOS, type Scenario, type Submission } from './scenarios'
import { mockRunners, proposedAdditions, GET_CUSTOMER_BOOKINGS_WITH_PHONE, SUBMIT_RESCHEDULE } from './mock-tools'

const RUN = process.env.AGENT_PROTOTYPE === '1'
const MODELS = (process.env.AGENT_PROTOTYPE_MODELS ?? 'claude-sonnet-5,claude-haiku-4-5').split(',').map(s => s.trim())
const RUNS = Number(process.env.AGENT_PROTOTYPE_RUNS ?? 3)
const ONLY = process.env.AGENT_PROTOTYPE_ONLY ?? ''
const OUT = process.env.AGENT_PROTOTYPE_OUT ?? path.join(process.cwd(), 'scripts/agent-prototype/out')

// Mirrors src/lib/ghost/agent-runtime.ts so the prototype behaves like production.
const MAX_TURNS = 6
const MAX_TOKENS = 1200

function anthropicKeyOnly(): string {
  const file = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  const m = file.match(/^ANTHROPIC_API_KEY=(.*)$/m)
  if (!m) throw new Error('ANTHROPIC_API_KEY not found in .env.local')
  return m[1].trim().replace(/^["']|["']$/g, '')
}

function guardFetch() {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname !== 'api.anthropic.com') throw new Error(`[agent-prototype] blocked network call to ${url.hostname}`)
    return real(input, init)
  }) as typeof fetch
}

interface Step { tool: string; input: Record<string, unknown>; result: string }
interface RunResult {
  scenario: string
  model: string
  run: number
  submission: Submission | null
  steps: Step[]
  turns: number
  pass: boolean
  why: string
  inputTokens: number
  outputTokens: number
  ms: number
  error?: string
}

function toolsFor(world: Scenario['world']) {
  const runners = mockRunners(world)
  const real = buildGhostTools()
  const names: string[] = [...INBOX_TOOL_NAMES, 'get_schedule'] // get_schedule: PROPOSED for the inbox agent
  const specs: Anthropic.Tool[] = real
    .filter(t => names.includes(t.name))
    .map(t => (t.name === 'get_customer_bookings' ? GET_CUSTOMER_BOOKINGS_WITH_PHONE : { name: t.name, description: t.description, input_schema: t.input_schema }))
  const submit: Anthropic.Tool[] = [...INBOX_SUBMIT_TOOLS, SUBMIT_RESCHEDULE]
  return { specs, submit, runners }
}

async function runOne(client: Anthropic, model: string, sc: Scenario, run: number): Promise<RunResult> {
  const started = Date.now()
  const { specs, submit, runners } = toolsFor(sc.world)
  const submitNames = new Set(submit.map(t => t.name))
  const prompt =
    buildInboxAgentPrompt({
      knowledgeBlock: '',
      correctionsBlock: '',
      contact: { name: sc.world.contact.name, email: sc.world.contact.email, locale: sc.world.contact.locale, notes: null },
      transcript: `CUSTOMER (${sc.world.contact.name}): ${sc.world.message}`,
      today: sc.world.today,
    }) + proposedAdditions(sc.world)

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
  const steps: Step[] = []
  let inputTokens = 0
  let outputTokens = 0
  const done = (submission: Submission | null, turns: number, error?: string): RunResult => {
    const verdict = sc.check(submission)
    return { scenario: sc.id, model, run, submission, steps, turns, ...verdict, inputTokens, outputTokens, ms: Date.now() - started, error }
  }

  try {
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const last = turn === MAX_TURNS
      const res = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: OFF_COURSE_SYSTEM_PROMPT,
        messages,
        tools: [...specs, ...submit],
        tool_choice: last ? { type: 'any' } : { type: 'auto' },
      })
      inputTokens += res.usage.input_tokens
      outputTokens += res.usage.output_tokens
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const sub = uses.find(u => submitNames.has(u.name))
      if (sub) return done({ via: sub.name, input: sub.input as Record<string, unknown> }, turn)
      if (!uses.length) {
        if (res.stop_reason === 'end_turn' && turn < MAX_TURNS) {
          messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: 'Finish by calling one of the submit tools with your proposal.' })
          continue
        }
        return done(null, turn, `stopped without submitting (${res.stop_reason})`)
      }
      messages.push({ role: 'assistant', content: res.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const u of uses) {
        const runner = runners[u.name]
        let text: string
        let isError = false
        try {
          if (!runner) throw new Error(`Unknown tool '${u.name}'`)
          text = JSON.stringify(runner(u.input as Record<string, unknown>))
        } catch (err) {
          text = `Tool error: ${err instanceof Error ? err.message : 'failed'}`
          isError = true
        }
        steps.push({ tool: u.name, input: u.input as Record<string, unknown>, result: text.length > 700 ? `${text.slice(0, 700)}…` : text })
        results.push({ type: 'tool_result', tool_use_id: u.id, content: text, is_error: isError })
      }
      messages.push({ role: 'user', content: results })
    }
    return done(null, MAX_TURNS, 'ran out of turns')
  } catch (err) {
    return done(null, 0, err instanceof Error ? err.message : String(err))
  }
}

async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < jobs.length) {
        const i = next++
        out[i] = await jobs[i]()
      }
    }),
  )
  return out
}

function report(results: RunResult[], scenarios: Scenario[]): string {
  const lines: string[] = ['# Inbox agent: reschedule prototype results', '', `Models: ${MODELS.join(', ')} · ${RUNS} runs per scenario · generated ${new Date().toISOString()}`, '']
  lines.push('## Summary', '', `| Scenario | Expected | ${MODELS.join(' | ')} |`, `|---|---|${MODELS.map(() => '---').join('|')}|`)
  for (const sc of scenarios) {
    const cells = MODELS.map(m => {
      const rs = results.filter(r => r.scenario === sc.id && r.model === m)
      return `${rs.filter(r => r.pass).length}/${rs.length}`
    })
    lines.push(`| ${sc.id} | ${sc.expected} | ${cells.join(' | ')} |`)
  }
  lines.push('', '## Tokens and speed', '', '| Model | Avg input tok | Avg output tok | Avg turns | Avg seconds |', '|---|---|---|---|---|')
  for (const m of MODELS) {
    const rs = results.filter(r => r.model === m)
    const avg = (f: (r: RunResult) => number) => (rs.reduce((a, r) => a + f(r), 0) / Math.max(rs.length, 1)).toFixed(0)
    lines.push(`| ${m} | ${avg(r => r.inputTokens)} | ${avg(r => r.outputTokens)} | ${(rs.reduce((a, r) => a + r.turns, 0) / Math.max(rs.length, 1)).toFixed(1)} | ${(rs.reduce((a, r) => a + r.ms, 0) / Math.max(rs.length, 1) / 1000).toFixed(1)} |`)
  }
  for (const sc of scenarios) {
    lines.push('', `## ${sc.id}: ${sc.title}`, '', `**Customer:** ${sc.world.message}`, '', `**Expected:** ${sc.expected}`)
    for (const r of results.filter(x => x.scenario === sc.id)) {
      lines.push('', `### ${r.pass ? '✅' : '❌'} ${r.model} · run ${r.run}`, '', `Outcome: ${r.why}${r.error ? ` · error: ${r.error}` : ''}`, '', 'Trace:')
      for (const s of r.steps) lines.push(`- \`${s.tool}\` ${JSON.stringify(s.input)} → ${s.result}`)
      if (r.submission) {
        lines.push('', `Submitted via \`${r.submission.via}\`:`, '```json', JSON.stringify(r.submission.input, null, 2), '```')
      }
    }
  }
  return lines.join('\n')
}

describe.skipIf(!RUN)('inbox agent reschedule prototype (real Claude, mocked world)', () => {
  it('runs every scenario on every model', { timeout: 45 * 60_000 }, async () => {
    guardFetch()
    const client = new Anthropic({ apiKey: anthropicKeyOnly() })
    const scenarios = SCENARIOS.filter(s => s.id.startsWith(ONLY))
    const jobs = scenarios.flatMap(sc => MODELS.flatMap(m => Array.from({ length: RUNS }, (_, i) => () => runOne(client, m, sc, i + 1))))
    const results = await pool(jobs, 6)
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'report.md'), report(results, scenarios))
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.scenario} ${r.model} #${r.run} — ${r.why}${r.error ? ` (${r.error})` : ''}`)
    console.log(`\nReport: ${path.join(OUT, 'report.md')}`)
  })
})
