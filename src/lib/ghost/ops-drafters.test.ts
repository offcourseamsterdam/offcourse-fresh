import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the drafters' I/O so they run with no network and no real Claude call.
// vitest hoists vi.mock above the imports below.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ meteredMessage: vi.fn() }))
vi.mock('@/lib/catering/filter', () => ({
  hasCatering: vi.fn(),
  filterCateringItems: vi.fn(),
}))
// Default to the non-auto rung so the pre-existing shadow-propose tests below
// need no changes; auto-path tests override this per-test.
vi.mock('@/lib/ghost/agents', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ghost/agents')>()
  return { ...actual, autonomyForKind: vi.fn(() => 'ask') }
})
vi.mock('@/lib/scheduling/apply-assignments', () => ({ applyScheduleAssignments: vi.fn() }))
// Freeze "today" so target_date / dedupe / horizon assertions never drift by day.
vi.mock('@/lib/utils', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    amsterdamToday: (offset = 0) => {
      const d = new Date(Date.UTC(2026, 5, 13)) // 2026-06-13
      d.setUTCDate(d.getUTCDate() + offset)
      return d.toISOString().slice(0, 10)
    },
  }
})

import { draftCateringOrders, draftOrAssignSchedule } from './ops-drafters'
import { createAdminClient } from '@/lib/supabase/admin'
import { meteredMessage } from '@/lib/ai/usage'
import { hasCatering, filterCateringItems } from '@/lib/catering/filter'
import { autonomyForKind } from './agents'
import { applyScheduleAssignments } from '@/lib/scheduling/apply-assignments'

const TODAY = '2026-06-13'
const TOMORROW = '2026-06-14'

/**
 * Chainable Supabase stub. `queues` is keyed by table name; each chain that
 * ends in an await (`.limit()`, `.order()`, `.eq()`, …) shifts the next result
 * off that table's queue. `.insert()` is captured (not queued) so we can assert
 * exactly what the drafter persists.
 */
function makeSupabase(
  queues: Record<string, Array<{ data: unknown }>> = {},
  opts: { insertError?: { message: string } } = {},
) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gte: () => builder,
      lte: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        return Promise.resolve(opts.insertError ? { data: null, error: opts.insertError } : { data: null, error: null })
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const q = queues[table]
        const result = q && q.length ? q.shift() : { data: null, error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return builder
  })
  return { client: { from }, from, inserts }
}

/** A Claude response shape that the real firstText() can read. */
function claudeJson(obj: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── catering_order (the "snack orders") ──────────────────────────────────────

describe('draftCateringOrders', () => {
  it('skips (no Claude call, no insert) when a proposal already exists for today', async () => {
    const sb = makeSupabase({ agent_proposals: [{ data: [{ id: 'existing' }] }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftCateringOrders()).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled() // dedupe must not spend tokens
    expect(sb.inserts).toHaveLength(0)
  })

  it('skips (no Claude call) when no upcoming booking has catering', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      bookings: [{ data: [{ id: 'b1', extras_selected: [] }] }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(hasCatering).mockReturnValue(false) // nothing to order

    expect(await draftCateringOrders()).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('drafts a shadow catering_order proposal for today on the happy path', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      bookings: [{ data: [{ id: 'b1', booking_date: TOMORROW, start_time: '17:00', listing_title: 'Sunset Cruise', guest_count: 8, extras_selected: [{ name: 'Cheese plate' }], catering_email_sent_at: null }] }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(hasCatering).mockReturnValue(true)
    vi.mocked(filterCateringItems).mockReturnValue([{ name: 'Cheese plate', quantity: 2 }] as never)
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({ orders: [{ date: TOMORROW, items: [{ name: 'Cheese plate', quantity: 2 }], urgent_unsent: 1 }], summary: 'Order 2 cheese plates for tomorrow; one email still unsent.' }) as never,
    )

    expect(await draftCateringOrders()).toBe('drafted')

    expect(sb.inserts).toHaveLength(1)
    const { table, row } = sb.inserts[0]
    expect(table).toBe('agent_proposals')
    expect(row.kind).toBe('catering_order')
    expect(row.status).toBe('shadow') // never executes — vision-doc invariant
    expect((row.payload as { target_date: string }).target_date).toBe(TODAY)
    expect((row.payload as { orders: unknown[] }).orders).toEqual([
      { date: TOMORROW, items: [{ name: 'Cheese plate', quantity: 2 }], urgent_unsent: 1 },
    ])
    expect(row.reasoning).toContain('cheese plates')
  })

  it('skips (no insert) when the model returns malformed JSON', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      bookings: [{ data: [{ id: 'b1', extras_selected: [{ name: 'x' }] }] }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(hasCatering).mockReturnValue(true)
    vi.mocked(filterCateringItems).mockReturnValue([{ name: 'x', quantity: 1 }] as never)
    vi.mocked(meteredMessage).mockResolvedValue({ content: [{ type: 'text', text: 'not json at all' }] } as never)

    expect(await draftCateringOrders()).toBe('skipped')
    expect(sb.inserts).toHaveLength(0) // never persist garbage as an actionable proposal
  })

  it('skips when "orders" is present but not an array', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      bookings: [{ data: [{ id: 'b1', extras_selected: [{ name: 'x' }] }] }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(hasCatering).mockReturnValue(true)
    vi.mocked(filterCateringItems).mockReturnValue([{ name: 'x', quantity: 1 }] as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson({ orders: 'oops', summary: 's' }) as never)

    expect(await draftCateringOrders()).toBe('skipped')
    expect(sb.inserts).toHaveLength(0)
  })

  it('swallows errors (returns skipped, never throws) — it runs in a cron', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('DB exploded')
    })
    await expect(draftCateringOrders()).resolves.toBe('skipped')
  })

  it('returns "skipped" — not a false-positive "drafted" — when saving the proposal fails', async () => {
    // Before this was fixed, a failed insert here fell through silently and
    // the function still returned 'drafted', even though nothing was saved.
    const sb = makeSupabase(
      {
        agent_proposals: [{ data: [] }],
        bookings: [{ data: [{ id: 'b1', booking_date: TOMORROW, start_time: '17:00', listing_title: 'Sunset Cruise', guest_count: 8, extras_selected: [{ name: 'Cheese plate' }], catering_email_sent_at: null }] }],
      },
      { insertError: { message: 'row-level security violation' } },
    )
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(hasCatering).mockReturnValue(true)
    vi.mocked(filterCateringItems).mockReturnValue([{ name: 'Cheese plate', quantity: 2 }] as never)
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({ orders: [{ date: TOMORROW, items: [{ name: 'Cheese plate', quantity: 2 }] }], summary: 'Order 2 cheese plates.' }) as never,
    )

    expect(await draftCateringOrders()).toBe('skipped')
    expect(console.error).toHaveBeenCalledWith('[ghost/catering_order] failed:', expect.stringContaining('row-level security violation'))
  })
})

// ── schedule_day (captain assignments) ───────────────────────────────────────

describe('draftOrAssignSchedule', () => {
  const openShift = { id: 's1', date: TOMORROW, start_at: '2026-06-14T15:00:00Z', end_at: '2026-06-14T17:00:00Z', status: 'open', staff_id: null, boats: { name: 'Diana' }, bookings: { listing_title: 'Sunset', guest_count: 6 } }
  // 2h at €25/h — used throughout to check cost_cents is real math (5000), never the model's.
  const activeStaff = { id: 'cap1', name: 'Sanne', role: 'captain', max_shifts_per_week: 5, is_active: true, hourly_rate_cents: 2500 }

  // Non-auto by default so the existing shadow-propose tests below are unchanged;
  // auto-path tests override this explicitly.
  beforeEach(() => {
    vi.mocked(autonomyForKind).mockReturnValue('ask')
  })

  it('skips (no Claude call) when a schedule proposal already exists for the target date', async () => {
    const sb = makeSupabase({ agent_proposals: [{ data: [{ id: 'existing' }] }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftOrAssignSchedule(TOMORROW)).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('skips (no Claude call) when there are no OPEN shifts to fill', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [{ data: [{ ...openShift, status: 'assigned' }] }], // all already assigned
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftOrAssignSchedule(TOMORROW)).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('skips (no Claude call) when there is an open shift but no active staff', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [{ data: [openShift] }],
      staff: [{ data: [] }], // nobody to assign
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftOrAssignSchedule(TOMORROW)).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('drafts a shadow schedule_day proposal when not at auto autonomy (the review-first fallback)', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [{ data: [openShift] }, { data: [] }], // target date's shifts, then recent-workload query
      staff: [{ data: [activeStaff] }],
      staff_availability: [{ data: [{ staff_id: 'cap1', status: 'available', note: null }] }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne', reason: 'Available and rested.' }], summary: 'Sanne takes the only open shift.' }) as never,
    )

    expect(await draftOrAssignSchedule(TOMORROW)).toBe('drafted')
    expect(applyScheduleAssignments).not.toHaveBeenCalled()

    expect(sb.inserts).toHaveLength(1)
    const { row } = sb.inserts[0]
    expect(row.kind).toBe('schedule_day')
    expect(row.status).toBe('shadow')
    expect((row.payload as { target_date: string }).target_date).toBe(TOMORROW)
    expect((row.payload as { assignments: unknown[] }).assignments).toEqual([
      { shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne', reason: 'Available and rested.', cost_cents: 5000 },
    ])
    expect(row.reasoning).toContain('Sanne')
  })

  it('skips (no insert) when the model output has no assignments array', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [{ data: [openShift] }, { data: [] }],
      staff: [{ data: [activeStaff] }],
      staff_availability: [{ data: [] }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson({ summary: 'no assignments key' }) as never)

    expect(await draftOrAssignSchedule(TOMORROW)).toBe('skipped')
    expect(sb.inserts).toHaveLength(0)
  })

  it('swallows errors (returns skipped, never throws)', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('DB exploded')
    })
    await expect(draftOrAssignSchedule(TOMORROW)).resolves.toBe('skipped')
  })

  it('returns "skipped" — not a false-positive "drafted" — when saving the shadow proposal fails', async () => {
    const sb = makeSupabase(
      {
        agent_proposals: [{ data: [] }],
        shifts: [{ data: [openShift] }, { data: [] }],
        staff: [{ data: [activeStaff] }],
        staff_availability: [{ data: [{ staff_id: 'cap1', status: 'available', note: null }] }],
      },
      { insertError: { message: 'row-level security violation' } },
    )
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne', reason: 'Available and rested.' }], summary: 'Sanne takes the only open shift.' }) as never,
    )

    expect(await draftOrAssignSchedule(TOMORROW)).toBe('skipped')
    expect(console.error).toHaveBeenCalledWith('[ghost/schedule_day] failed:', expect.stringContaining('row-level security violation'))
  })

  describe('at auto autonomy (owner-approved 2026-08-06 proactive auto-assign)', () => {
    beforeEach(() => {
      vi.mocked(autonomyForKind).mockReturnValue('auto')
    })

    it('assigns for real via applyScheduleAssignments — no shadow proposal', async () => {
      const sb = makeSupabase({
        shifts: [{ data: [openShift] }, { data: [] }],
        staff: [{ data: [activeStaff] }],
        staff_availability: [{ data: [{ staff_id: 'cap1', status: 'available', note: null }] }],
      })
      vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
      vi.mocked(meteredMessage).mockResolvedValue(
        claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne', reason: 'Available and rested.' }], summary: 'Sanne takes the only open shift.' }) as never,
      )
      vi.mocked(applyScheduleAssignments).mockResolvedValue({ applied: [{ shift_id: 's1', staff_name: 'Sanne' }], skipped: [] })

      expect(await draftOrAssignSchedule(TOMORROW)).toBe('assigned')

      expect(applyScheduleAssignments).toHaveBeenCalledWith(
        sb.client,
        [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne', reason: 'Available and rested.', cost_cents: 5000 }],
        expect.objectContaining({ actorType: 'agent', actorId: 'ops_optimizer', source: 'ghost/schedule_day:auto' }),
        { notify: false },
      )

      // Still logs an audit-trail row, but already 'executed' — nothing left to approve.
      expect(sb.inserts).toHaveLength(1)
      const { row } = sb.inserts[0]
      expect(row.kind).toBe('schedule_day')
      expect(row.status).toBe('executed')
      expect(row.outcome).toBeTruthy()
    })

    it('does not dedupe on target_date — a fresh booking can still open a new shift on an already-scanned date', async () => {
      const sb = makeSupabase({
        agent_proposals: [{ data: [{ id: 'already-scanned-earlier-today' }] }], // would block the shadow path (see first test above)
        shifts: [{ data: [openShift] }, { data: [] }],
        staff: [{ data: [activeStaff] }],
        staff_availability: [{ data: [{ staff_id: 'cap1', status: 'available', note: null }] }],
      })
      vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
      vi.mocked(meteredMessage).mockResolvedValue(
        claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne' }], summary: 'ok' }) as never,
      )
      vi.mocked(applyScheduleAssignments).mockResolvedValue({ applied: [{ shift_id: 's1', staff_name: 'Sanne' }], skipped: [] })

      expect(await draftOrAssignSchedule(TOMORROW)).toBe('assigned')
      expect(meteredMessage).toHaveBeenCalled() // proves it did NOT early-return on the existing proposal
    })

    it('still reports "assigned" if the audit-log insert fails afterward — the real assignment already landed', async () => {
      const sb = makeSupabase(
        {
          shifts: [{ data: [openShift] }, { data: [] }],
          staff: [{ data: [activeStaff] }],
          staff_availability: [{ data: [{ staff_id: 'cap1', status: 'available', note: null }] }],
        },
        { insertError: { message: 'row-level security violation' } },
      )
      vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
      vi.mocked(meteredMessage).mockResolvedValue(
        claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne' }], summary: 'ok' }) as never,
      )
      vi.mocked(applyScheduleAssignments).mockResolvedValue({ applied: [{ shift_id: 's1', staff_name: 'Sanne' }], skipped: [] })

      expect(await draftOrAssignSchedule(TOMORROW)).toBe('assigned')
      expect(console.error).toHaveBeenCalledWith('[ghost/schedule_day] auto-assigned but failed to log proposal:', 'row-level security violation')
    })

    it('rejects (safety net) an assignment to someone marked unavailable, even though the model proposed it', async () => {
      const sb = makeSupabase({
        shifts: [{ data: [openShift] }, { data: [] }],
        staff: [{ data: [activeStaff] }],
        staff_availability: [{ data: [{ staff_id: 'cap1', status: 'unavailable', note: 'sick' }] }],
      })
      vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
      vi.mocked(meteredMessage).mockResolvedValue(
        claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne' }], summary: 'ok' }) as never,
      )

      expect(await draftOrAssignSchedule(TOMORROW)).toBe('skipped')
      expect(applyScheduleAssignments).not.toHaveBeenCalled()
    })

    it('rejects (safety net) an assignment that would double-book a captain against an existing overlapping shift', async () => {
      // 16:00–18:00, overlapping openShift's 15:00–17:00 by an hour.
      const alreadyAssignedOverlap = { id: 's-existing', date: TOMORROW, start_at: '2026-06-14T16:00:00Z', end_at: '2026-06-14T18:00:00Z', status: 'assigned', staff_id: 'cap1', boats: { name: 'Curaçao' }, bookings: null }
      const sb = makeSupabase({
        shifts: [{ data: [openShift, alreadyAssignedOverlap] }, { data: [] }],
        staff: [{ data: [activeStaff] }],
        staff_availability: [{ data: [{ staff_id: 'cap1', status: 'available', note: null }] }],
      })
      vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
      vi.mocked(meteredMessage).mockResolvedValue(
        claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne' }], summary: 'ok' }) as never,
      )

      expect(await draftOrAssignSchedule(TOMORROW)).toBe('skipped')
      expect(applyScheduleAssignments).not.toHaveBeenCalled()
    })

    it('skips (no applyScheduleAssignments call) when applying finds nothing left open (a manual change already won)', async () => {
      const sb = makeSupabase({
        shifts: [{ data: [openShift] }, { data: [] }],
        staff: [{ data: [activeStaff] }],
        staff_availability: [{ data: [{ staff_id: 'cap1', status: 'available', note: null }] }],
      })
      vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
      vi.mocked(meteredMessage).mockResolvedValue(
        claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne' }], summary: 'ok' }) as never,
      )
      vi.mocked(applyScheduleAssignments).mockResolvedValue({ applied: [], skipped: [{ shift_id: 's1', reason: 'no longer open (manual change wins)' }] })

      expect(await draftOrAssignSchedule(TOMORROW)).toBe('skipped')
      expect(sb.inserts).toHaveLength(0) // nothing applied = nothing worth logging
    })
  })
})
