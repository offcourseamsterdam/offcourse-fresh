/**
 * Day optimizer agent — real Claude, made-up conflicts.
 *
 * resolveDayPlan's clustering and safety net are unit-tested with the model
 * mocked (src/lib/ghost/day-optimizer-agent.test.ts). This checks the part a
 * mock can't: does the real model make good calls when moves compete?
 *
 * Opt-in; self-skips in `npm test`:
 *   AGENT_PROTOTYPE=1 npx vitest run scripts/agent-prototype/day-optimizer
 * Knobs: AGENT_PROTOTYPE_RUNS (per scenario, default 3).
 *
 * Safety: only ANTHROPIC_API_KEY is read from .env.local; fetch is limited to
 * api.anthropic.com; Supabase, AI-usage metering and the ops_events log are
 * mocked (nothing is written anywhere).
 */
import { describe, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const { blocked } = vi.hoisted(() => ({
  blocked: (what: string) => () => {
    throw new Error(`[day-optimizer prototype] blocked call to ${what}`)
  },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: blocked('Supabase') }))
vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: async () => {}, meteredMessage: blocked('ai_usage') }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: async () => {} }))

import { resolveDayPlan, type DayOptimizerCandidate } from '@/lib/ghost/day-optimizer-agent'

const RUN = process.env.AGENT_PROTOTYPE === '1'
const RUNS = Number(process.env.AGENT_PROTOTYPE_RUNS ?? 3)

interface Scenario {
  id: string
  title: string
  candidates: DayOptimizerCandidate[]
  /** Exactly these ids should be allowed. */
  expectPicked: string[]
}

const swap = (id: string, day: string, eur: number, what: string): DayOptimizerCandidate => ({
  id,
  type: 'boat_swap',
  daysTouched: [day],
  summary: `${what} could move to the other boat at the same time — frees a captain for the day.`,
  estSavingCents: eur * 100,
})
const cross = (id: string, from: string, to: string, eur: number, what: string): DayOptimizerCandidate => ({
  id,
  type: 'cross_day',
  daysTouched: [from, to],
  summary: `${what} (${from}) could join the ${to} departure instead — frees the whole ${from} shift.`,
  estSavingCents: eur * 100,
})
const time = (id: string, day: string, eur: number, what: string): DayOptimizerCandidate => ({
  id,
  type: 'time_move',
  daysTouched: [day],
  summary: `${what} could sail 2 hours earlier on the same boat — closes a paid gap.`,
  estSavingCents: eur * 100,
})

const SCENARIOS: Scenario[] = [
  {
    id: 'big-saving-wins',
    title: 'Cross-day move saves 12x more than a boat swap on the same day',
    candidates: [swap('swap', '2026-10-03', 20, 'Sven (4 guests)'), cross('cross', '2026-10-03', '2026-10-04', 250, 'Mia (2 guests)')],
    expectPicked: ['cross'],
  },
  {
    id: 'two-swaps',
    title: 'Two boat swaps on the same day — €40 vs €150',
    candidates: [swap('small', '2026-10-03', 40, 'Tom (3 guests)'), swap('large', '2026-10-03', 150, 'Eva (6 guests)')],
    expectPicked: ['large'],
  },
  {
    id: 'chain',
    title: 'A chain across three days — the best COMBINATION, not the single biggest',
    // A (Oct 4-5, €300) and C (Oct 6, €150) don't share a day: €450 together.
    // B (Oct 5-6, €200) blocks both. Best total is A + C.
    candidates: [
      cross('A', '2026-10-04', '2026-10-05', 300, 'Group A (3 guests)'),
      cross('B', '2026-10-05', '2026-10-06', 200, 'Group B (2 guests)'),
      swap('C', '2026-10-06', 150, 'Group C (5 guests)'),
    ],
    expectPicked: ['A', 'C'],
  },
  {
    id: 'time-vs-swap',
    title: 'Time shift saves 3x a boat swap on the same day',
    candidates: [time('time', '2026-10-03', 120, 'Noor (4 guests)'), swap('swap', '2026-10-03', 40, 'Bram (2 guests)')],
    expectPicked: ['time'],
  },
  {
    id: 'near-tie-gentler',
    title: 'Near-tie: gentle boat swap €180 vs date-changing cross-day €200',
    candidates: [swap('swap', '2026-10-03', 180, 'Lisa (6 guests)'), cross('cross', '2026-10-03', '2026-10-04', 200, 'Mark (2 guests)')],
    expectPicked: ['swap'],
  },
]

function useOnlyTheAnthropicKey() {
  const file = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  const m = file.match(/^ANTHROPIC_API_KEY=(.*)$/m)
  if (!m) throw new Error('ANTHROPIC_API_KEY not found in .env.local')
  process.env.ANTHROPIC_API_KEY = m[1].trim().replace(/^["']|["']$/g, '')
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.hostname !== 'api.anthropic.com') throw new Error(`blocked network call to ${url.hostname}`)
    return real(input, init)
  }) as typeof fetch
}

describe.skipIf(!RUN)('day optimizer agent — real model', () => {
  it('makes the expected call on every conflict', { timeout: 20 * 60_000 }, async () => {
    useOnlyTheAnthropicKey()
    const lines: string[] = []
    let passed = 0
    let total = 0
    for (const sc of SCENARIOS) {
      for (let run = 1; run <= RUNS; run++) {
        total++
        const decisions = await resolveDayPlan(sc.candidates, { recheckBoatSwap: async () => ({ bookable: true }) })
        const picked = sc.candidates.filter(c => decisions.get(c.id)?.allowed).map(c => c.id).sort()
        const ok = JSON.stringify(picked) === JSON.stringify([...sc.expectPicked].sort())
        if (ok) passed++
        lines.push(`${ok ? 'PASS' : 'FAIL'} ${sc.id} #${run} — picked [${picked.join(', ')}], expected [${sc.expectPicked.join(', ')}]`)
        for (const c of sc.candidates) lines.push(`      ${c.id}: ${decisions.get(c.id)?.reasoning ?? '(no reasoning)'}`)
      }
    }
    const out = path.join(process.cwd(), 'scripts/agent-prototype/out')
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'day-optimizer.txt'), `${lines.join('\n')}\n\n${passed}/${total} passed\n`)
  })
})
