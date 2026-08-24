import { describe, it, expect, vi } from 'vitest'
import { fetchPayrollRange } from './payroll-query'

function makeSupabase(
  opts: { entries?: unknown[]; staff?: unknown[]; bonuses?: unknown[]; extraHoursBonuses?: unknown[] } = {},
) {
  const bonusesQuery = {
    eq: vi.fn(function (this: unknown) { return this }),
    gte: vi.fn(function (this: unknown) { return this }),
    lte: vi.fn(function (this: unknown) { return Promise.resolve({ data: opts.bonuses ?? [], error: null }) }),
  }
  const from = vi.fn((table: string) => {
    if (table === 'time_entries') {
      return { select: () => ({ gte: () => ({ lte: () => ({ order: async () => ({ data: opts.entries ?? [], error: null }) }) }) }) }
    }
    if (table === 'staff') {
      return { select: () => ({ order: async () => ({ data: opts.staff ?? [], error: null }) }) }
    }
    if (table === 'review_bonuses') {
      return { select: () => bonusesQuery }
    }
    if (table === 'extra_hours_bonuses') {
      return { select: () => ({ gte: () => ({ lte: () => ({ order: async () => ({ data: opts.extraHoursBonuses ?? [], error: null }) }) }) }) }
    }
    throw new Error(`unexpected table "${table}"`)
  })
  return { client: { from } as never, bonusesQuery }
}

describe('fetchPayrollRange — review_bonuses exclusion (Beer, 2026-08-23: "we wont pay out bonuses this month")', () => {
  it('filters the review_bonuses query to excluded_from_payroll = false', async () => {
    const { client, bonusesQuery } = makeSupabase()

    await fetchPayrollRange(client, '2026-08-01', '2026-08-31')

    expect(bonusesQuery.eq).toHaveBeenCalledWith('excluded_from_payroll', false)
  })

  it('still returns whatever bonuses come back from the (already-filtered) query', async () => {
    const bonuses = [{ staff_id: 's1', amount_cents: 500 }]
    const { client } = makeSupabase({ bonuses })

    const result = await fetchPayrollRange(client, '2026-08-01', '2026-08-31')

    expect(result.bonuses).toEqual(bonuses)
  })

  it('returns entries and staff alongside bonuses', async () => {
    const entries = [{ id: 'e1', staff_id: 's1' }]
    const staff = [{ id: 's1', name: 'Sophie', role: 'skipper' }]
    const { client } = makeSupabase({ entries, staff })

    const result = await fetchPayrollRange(client, '2026-08-01', '2026-08-31')

    expect(result.entries).toEqual(entries)
    expect(result.staff).toEqual(staff)
  })

  it('returns extra_hours_bonuses (Beer, 2026-08-24: on-the-water upsell commission) alongside the rest', async () => {
    const extraHoursBonuses = [{ id: 'x1', staff_id: 's1', date: '2026-08-15', extra_minutes: 30, amount_charged_cents: 2000, commission_cents: 1000, note: null }]
    const { client } = makeSupabase({ extraHoursBonuses })

    const result = await fetchPayrollRange(client, '2026-08-01', '2026-08-31')

    expect(result.extraHoursBonuses).toEqual(extraHoursBonuses)
  })
})
