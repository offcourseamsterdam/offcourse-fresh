import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { finishMoves, pickNightlyMove, type OptimizerItem, type PreparedItem } from './move-planner'
import type { DayPlanDecision } from './day-optimizer-agent'

const item = (bookingId: string, kind: OptimizerItem['kind'] = 'same_day_time_move'): OptimizerItem => ({
  kind,
  date: '2026-10-03',
  boat: 'Diana',
  summary: bookingId,
  estSavingCents: 100,
  bookingId,
})

function live(id: string, days: string[], saving: number, drafted = true): PreparedItem & { finish: ReturnType<typeof vi.fn> } {
  const base = item(id)
  return {
    item: base,
    live: { id, type: 'time_move', daysTouched: days, summary: id, estSavingCents: saving },
    finish: vi.fn(async () => (drafted ? { ...base, proposalId: `p-${id}` } : { ...base, notAskedReason: 'x', notAskedBy: 'rule' as const })),
  }
}

const plan = (entries: Record<string, DayPlanDecision>) => new Map(Object.entries(entries))

describe('finishMoves', () => {
  it('drafts allowed moves, and labels the ones the agent passed over with its own reasoning', async () => {
    const a = live('a', ['2026-10-03'], 200)
    const b = live('b', ['2026-10-03'], 100)
    const { items, drafted } = await finishMoves(
      [a, b],
      plan({ a: { allowed: true }, b: { allowed: false, reasoning: 'Moves their date; a is gentler.' } }),
      { source: 'test', reasoningSuffix: 'test' },
    )
    expect(a.finish).toHaveBeenCalledTimes(1)
    expect(b.finish).not.toHaveBeenCalled()
    expect(drafted).toBe(1)
    expect(items[1]).toMatchObject({ notAskedReason: 'Moves their date; a is gentler.', notAskedBy: 'agent' })
  })

  it('passes rule-held findings through untouched', async () => {
    const heldItem: PreparedItem = { item: { ...item('c'), notAskedReason: 'Too close to departure to ask the guest.', notAskedBy: 'rule' } }
    const { items } = await finishMoves([heldItem], plan({}), { source: 'test', reasoningSuffix: 'test' })
    expect(items[0].notAskedReason).toBe('Too close to departure to ask the guest.')
  })

  it("only drafts what shouldDraft accepts — the new-booking trigger's own date", async () => {
    const onDate = live('on', ['2026-10-03'], 100)
    const otherDay = live('other', ['2026-10-04'], 300)
    const { drafted } = await finishMoves(
      [onDate, otherDay],
      plan({ on: { allowed: true }, other: { allowed: true } }),
      { source: 'test', reasoningSuffix: 'test' },
      p => p.live.daysTouched.includes('2026-10-03'),
    )
    expect(onDate.finish).toHaveBeenCalled()
    expect(otherDay.finish).not.toHaveBeenCalled()
    expect(drafted).toBe(1)
  })

  it('does not count a draft that failed to write', async () => {
    const failing = live('f', ['2026-10-03'], 100, false)
    const { drafted } = await finishMoves([failing], plan({ f: { allowed: true } }), { source: 'test', reasoningSuffix: 'test' })
    expect(drafted).toBe(0)
  })
})

describe('pickNightlyMove', () => {
  it('picks the highest-saving move the day plan allows, across every move kind', () => {
    const small = live('small', ['2026-10-03'], 100)
    const bigButSkipped = live('big', ['2026-10-03'], 900)
    const medium = live('medium', ['2026-10-05'], 400)
    const best = pickNightlyMove(
      [small, bigButSkipped, medium],
      plan({ small: { allowed: true }, big: { allowed: false }, medium: { allowed: true } }),
    )
    expect(best?.live.id).toBe('medium')
  })

  it('returns null when nothing is allowed', () => {
    expect(pickNightlyMove([live('a', ['2026-10-03'], 100)], plan({ a: { allowed: false } }))).toBeNull()
  })
})
