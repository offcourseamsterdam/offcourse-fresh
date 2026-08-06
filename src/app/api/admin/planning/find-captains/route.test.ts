import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  syncShiftsForRange: vi.fn(),
  runProactiveScheduling: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/scheduling/sync-shifts', () => ({ syncShiftsForRange: h.syncShiftsForRange }))
vi.mock('@/lib/scheduling/proactive-scheduling', () => ({ runProactiveScheduling: h.runProactiveScheduling }))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.syncShiftsForRange.mockResolvedValue({ created: 0, updated: 0, skipped: [] })
})

describe('POST /api/admin/planning/find-captains', () => {
  it('syncs the horizon, runs the proactive scan, and summarizes the results', async () => {
    h.runProactiveScheduling.mockResolvedValue([
      { date: '2026-08-06', result: 'assigned' },
      { date: '2026-08-07', result: 'assigned' },
      { date: '2026-08-08', result: 'drafted' },
      { date: '2026-08-09', result: 'skipped' },
      { date: '2026-08-10', result: 'skipped' },
    ])

    const res = await POST()
    const body = await res.json()

    expect(h.syncShiftsForRange).toHaveBeenCalledTimes(1)
    expect(h.runProactiveScheduling).toHaveBeenCalledTimes(1)
    expect(body.data.summary).toEqual({ assigned: 2, drafted: 1, skipped: 2 })
    expect(body.data.results).toHaveLength(5)
  })

  it('does not run the scan at all if the sync itself fails', async () => {
    h.syncShiftsForRange.mockResolvedValue({ error: 'db unreachable' })

    const res = await POST()

    expect(res.status).not.toBe(200)
    expect(h.runProactiveScheduling).not.toHaveBeenCalled()
  })

  it('returns a clean zero summary when nothing needed doing', async () => {
    h.runProactiveScheduling.mockResolvedValue([])

    const res = await POST()
    const body = await res.json()

    expect(body.data.summary).toEqual({ assigned: 0, drafted: 0, skipped: 0 })
  })
})
