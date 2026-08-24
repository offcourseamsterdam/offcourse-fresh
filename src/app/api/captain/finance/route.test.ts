import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-captain', () => ({ requireCaptain: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { GET } from './route'
import { requireCaptain } from '@/lib/auth/require-captain'
import { createAdminClient } from '@/lib/supabase/admin'

const STAFF = { staff: { id: 'staff-1' } }

function makeReq(url: string) {
  return { url: `http://x${url}` } as never
}

function makeSupabase(opts: {
  entries?: { clock_in_at: string; clock_out_at: string | null; hourly_rate_cents: number }[]
  reviewBonuses?: { amount_cents: number; excluded_from_payroll?: boolean }[]
  extraHours?: { date: string; extra_minutes: number; amount_charged_cents: number; commission_cents: number; note: string | null }[]
}) {
  const from = vi.fn((table: string) => {
    if (table === 'time_entries') {
      return { select: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: opts.entries ?? [], error: null }) }) }) }) }
    }
    if (table === 'review_bonuses') {
      return { select: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: opts.reviewBonuses ?? [], error: null }) }) }) }) }
    }
    if (table === 'extra_hours_bonuses') {
      return { select: () => ({ eq: () => ({ gte: () => ({ lte: () => ({ order: async () => ({ data: opts.extraHours ?? [], error: null }) }) }) }) }) }
    }
    throw new Error(`unexpected table "${table}"`)
  })
  return { from } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCaptain).mockResolvedValue(STAFF as never)
})

describe('GET /api/captain/finance', () => {
  it('rejects a missing/malformed month', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({}))
    const res = await GET(makeReq('/api/captain/finance'))
    expect(res.status).toBe(400)
  })

  it('sums closed time entries into cruised minutes and base pay, ignoring an open entry', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabase({
        entries: [
          { clock_in_at: '2026-08-05T08:00:00.000Z', clock_out_at: '2026-08-05T10:00:00.000Z', hourly_rate_cents: 2000 }, // 2h @ €20 = €40
          { clock_in_at: '2026-08-10T08:00:00.000Z', clock_out_at: null, hourly_rate_cents: 2000 }, // still open — not counted
        ],
      }),
    )
    const res = await GET(makeReq('/api/captain/finance?month=2026-08'))
    const body = await res.json()
    expect(body.data.cruisedMinutes).toBe(120)
    expect(body.data.basePayCents).toBe(4000)
  })

  it('counts reviews assigned and sums the review bonus', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabase({ reviewBonuses: [{ amount_cents: 500 }, { amount_cents: 500 }] }),
    )
    const res = await GET(makeReq('/api/captain/finance?month=2026-08'))
    const body = await res.json()
    expect(body.data.reviewsAssigned).toBe(2)
    expect(body.data.reviewBonusCents).toBe(1000)
  })

  it('counts a payroll-excluded review mention toward reviewsAssigned but not toward the bonus money (2026-08-22/23 backfill: "we wont pay out bonuses this month")', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabase({
        reviewBonuses: [
          { amount_cents: 500, excluded_from_payroll: false },
          { amount_cents: 500, excluded_from_payroll: true },
        ],
      }),
    )
    const res = await GET(makeReq('/api/captain/finance?month=2026-08'))
    const body = await res.json()
    expect(body.data.reviewsAssigned).toBe(2) // both mentions are genuinely theirs
    expect(body.data.reviewBonusCents).toBe(500) // only the non-excluded one pays out
  })

  it('sums extra-hours (upsell) commission and passes through the entry list', async () => {
    const extraHours = [{ date: '2026-08-15', extra_minutes: 30, amount_charged_cents: 2000, commission_cents: 1000, note: null }]
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ extraHours }))
    const res = await GET(makeReq('/api/captain/finance?month=2026-08'))
    const body = await res.json()
    expect(body.data.extraHoursBonusCents).toBe(1000)
    expect(body.data.extraHoursEntries).toEqual(extraHours)
  })

  it('totals base pay + review bonus + extra-hours commission', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabase({
        entries: [{ clock_in_at: '2026-08-05T08:00:00.000Z', clock_out_at: '2026-08-05T10:00:00.000Z', hourly_rate_cents: 2000 }],
        reviewBonuses: [{ amount_cents: 500 }],
        extraHours: [{ date: '2026-08-15', extra_minutes: 30, amount_charged_cents: 2000, commission_cents: 1000, note: null }],
      }),
    )
    const res = await GET(makeReq('/api/captain/finance?month=2026-08'))
    const body = await res.json()
    expect(body.data.totalCents).toBe(4000 + 500 + 1000)
  })
})
