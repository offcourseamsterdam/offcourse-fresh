import { describe, it, expect, vi, afterEach } from 'vitest'
import { clusterCandidates, pickBySavingsFallback, resolveDayPlan, type DayOptimizerCandidate } from './day-optimizer-agent'

vi.mock('@/lib/ai/usage', () => ({ recordAiUsage: vi.fn() }))
vi.mock('@/lib/ai/clients', () => ({ getClaude: vi.fn(), CLAUDE_AGENT_MODEL: 'claude-sonnet-5' }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))

// Each mocked test spies on runAgenticLoop with a *Once implementation — restore
// between tests so an earlier test's queued mock never leaks into the next one.
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const swap = (id: string, day: string, saving: number | null): DayOptimizerCandidate => ({
  id,
  type: 'boat_swap',
  daysTouched: [day],
  summary: `swap ${id}`,
  estSavingCents: saving,
})
const cross = (id: string, from: string, to: string, saving: number): DayOptimizerCandidate => ({
  id,
  type: 'cross_day',
  daysTouched: [from, to],
  summary: `cross ${id}`,
  estSavingCents: saving,
})

describe('clusterCandidates', () => {
  it('keeps candidates on different days in separate clusters', () => {
    const clusters = clusterCandidates([swap('a', '2026-10-03', 100), swap('b', '2026-10-04', 200)])
    expect(clusters).toHaveLength(2)
  })

  it('groups two candidates that share a day into one cluster', () => {
    const clusters = clusterCandidates([swap('a', '2026-10-03', 100), swap('b', '2026-10-03', 200)])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].map(c => c.id).sort()).toEqual(['a', 'b'])
  })

  it('chains a cross-day candidate into whatever else touches either of its two days', () => {
    // c touches Oct 4 and Oct 5; a same-day swap on Oct 5 shares Oct 5 with it,
    // and a swap on Oct 3 is unrelated to both.
    const clusters = clusterCandidates([swap('unrelated', '2026-10-03', 50), cross('c', '2026-10-04', '2026-10-05', 300), swap('shares-oct5', '2026-10-05', 150)])
    const byId = (id: string) => clusters.find(g => g.some(x => x.id === id))!
    expect(byId('c')).toBe(byId('shares-oct5'))
    expect(byId('c')).not.toBe(byId('unrelated'))
  })
})

describe('pickBySavingsFallback', () => {
  it('picks the higher-saving candidate and skips the one sharing its day', () => {
    const result = pickBySavingsFallback([swap('cheap', '2026-10-03', 100), swap('expensive', '2026-10-03', 500)])
    expect(result).toEqual({ picks: ['expensive'], skipped: ['cheap'] })
  })

  it('keeps both when they touch different days', () => {
    const result = pickBySavingsFallback([swap('a', '2026-10-03', 100), swap('b', '2026-10-04', 100)])
    expect(result.picks.sort()).toEqual(['a', 'b'])
  })

  it('treats null savings as lowest priority, never crashes on it', () => {
    const result = pickBySavingsFallback([swap('unpriced', '2026-10-03', null), swap('priced', '2026-10-03', 50)])
    expect(result).toEqual({ picks: ['priced'], skipped: ['unpriced'] })
  })
})

describe('resolveDayPlan', () => {
  const noRecheck = { recheckBoatSwap: vi.fn() }

  it('allows a lone candidate with no cluster-mates — never calls the agent', async () => {
    const decisions = await resolveDayPlan([swap('a', '2026-10-03', 100)], noRecheck)
    expect(decisions.get('a')).toEqual({ allowed: true })
  })

  it('falls back to the highest-saving pick when the agent throws', async () => {
    const { runAgenticLoop } = await import('./agent-runtime')
    vi.spyOn(await import('./agent-runtime'), 'runAgenticLoop').mockRejectedValueOnce(new Error('API down'))
    const decisions = await resolveDayPlan([swap('cheap', '2026-10-03', 100), swap('expensive', '2026-10-03', 500)], noRecheck)
    expect(decisions.get('expensive')?.allowed).toBe(true)
    expect(decisions.get('cheap')?.allowed).toBe(false)
    void runAgenticLoop
  })

  it("never allows two picks that share a day, even if the agent's own answer breaks that rule", async () => {
    vi.spyOn(await import('./agent-runtime'), 'runAgenticLoop').mockResolvedValueOnce({
      submission: {
        picks: [
          { id: 'a', why: 'good' },
          { id: 'b', why: 'also good' },
        ],
        skipped: [],
        reasoning: 'both look fine',
      },
      submittedVia: 'submit_day_plan',
      steps: [],
      turns: 1,
    })
    const decisions = await resolveDayPlan([swap('a', '2026-10-03', 100), swap('b', '2026-10-03', 200)], noRecheck)
    const allowed = [decisions.get('a')?.allowed, decisions.get('b')?.allowed].filter(Boolean).length
    expect(allowed).toBe(1)
  })

  it('ignores a pick id the agent invented that was never in the cluster', async () => {
    vi.spyOn(await import('./agent-runtime'), 'runAgenticLoop').mockResolvedValueOnce({
      submission: { picks: [{ id: 'not-a-real-candidate', why: 'oops' }], skipped: [], reasoning: 'x' },
      submittedVia: 'submit_day_plan',
      steps: [],
      turns: 1,
    })
    const decisions = await resolveDayPlan([swap('a', '2026-10-03', 100)], noRecheck)
    // 'a' has no cluster-mate, so it's auto-allowed before the agent is ever called.
    expect(decisions.get('a')).toEqual({ allowed: true })
  })

  it('carries the reasoning through for both the picked and skipped candidates', async () => {
    vi.spyOn(await import('./agent-runtime'), 'runAgenticLoop').mockResolvedValueOnce({
      submission: {
        picks: [{ id: 'gentle-swap', why: 'Keeps the same date, only swaps boats — less disruptive.' }],
        skipped: [{ id: 'disruptive-move', why: 'Would change the guest’s date; the swap achieves a similar saving.' }],
        reasoning: 'Picked the boat swap over the cross-day move.',
      },
      submittedVia: 'submit_day_plan',
      steps: [],
      turns: 2,
    })
    const decisions = await resolveDayPlan([swap('gentle-swap', '2026-10-03', 100), cross('disruptive-move', '2026-10-03', '2026-10-06', 120)], noRecheck)
    expect(decisions.get('gentle-swap')).toEqual({ allowed: true, reasoning: 'Keeps the same date, only swaps boats — less disruptive.' })
    expect(decisions.get('disruptive-move')).toEqual({ allowed: false, reasoning: "Would change the guest’s date; the swap achieves a similar saving." })
  })

  it("respects the agent deciding neither move is worth asking about — never overridden by the fallback", async () => {
    vi.spyOn(await import('./agent-runtime'), 'runAgenticLoop').mockResolvedValueOnce({
      submission: {
        picks: [],
        skipped: [
          { id: 'a', why: 'Saving is tiny; not worth a message.' },
          { id: 'b', why: 'Same.' },
        ],
        reasoning: 'Neither is worth a guest message.',
      },
      submittedVia: 'submit_day_plan',
      steps: [],
      turns: 1,
    })
    const decisions = await resolveDayPlan([swap('a', '2026-10-03', 100), swap('b', '2026-10-03', 200)], noRecheck)
    expect(decisions.get('a')?.allowed).toBe(false)
    expect(decisions.get('b')?.allowed).toBe(false)
    expect(decisions.get('a')?.reasoning).toBe('Saving is tiny; not worth a message.')
  })

  it('falls back when the agent only names ids that were never in the cluster', async () => {
    vi.spyOn(await import('./agent-runtime'), 'runAgenticLoop').mockResolvedValueOnce({
      submission: { picks: [{ id: 'ghost-id', why: 'x' }], skipped: [], reasoning: 'x' },
      submittedVia: 'submit_day_plan',
      steps: [],
      turns: 1,
    })
    const decisions = await resolveDayPlan([swap('cheap', '2026-10-03', 100), swap('expensive', '2026-10-03', 500)], noRecheck)
    expect(decisions.get('expensive')?.allowed).toBe(true)
    expect(decisions.get('cheap')?.allowed).toBe(false)
  })

  it('logs every real conflict decision to ops_events, marked agent vs fallback', async () => {
    const { emitOpsEvent } = await import('@/lib/ops/events')
    vi.spyOn(await import('./agent-runtime'), 'runAgenticLoop').mockRejectedValueOnce(new Error('down'))
    await resolveDayPlan([swap('a', '2026-10-03', 100), swap('b', '2026-10-03', 200)], noRecheck)
    expect(emitOpsEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'system',
      source: 'ghost/day-optimizer-agent',
      payload: expect.objectContaining({ picked: ['b'], used_fallback: 'true', cluster_key: 'a|b' }),
    }))
  })

  it('reuses a recent decision for the identical conflict instead of asking the agent again', async () => {
    const spy = vi.spyOn(await import('./agent-runtime'), 'runAgenticLoop')
    const { emitOpsEvent } = await import('@/lib/ops/events')
    const decisions = await resolveDayPlan([swap('a', '2026-10-03', 100), swap('b', '2026-10-03', 200)], {
      ...noRecheck,
      priorDecision: async key => (key === 'a|b' ? { picked: ['a'], perCandidate: { a: 'Gentler for the guest.', b: 'Would move their date.' } } : null),
    })
    expect(spy).not.toHaveBeenCalled()
    expect(emitOpsEvent).not.toHaveBeenCalled()
    expect(decisions.get('a')).toEqual({ allowed: true, reasoning: 'Gentler for the guest.' })
    expect(decisions.get('b')).toEqual({ allowed: false, reasoning: 'Would move their date.' })
  })
})
