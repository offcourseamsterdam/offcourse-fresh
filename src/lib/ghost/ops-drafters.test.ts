import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the drafters' I/O so they run with no network and no real Claude call.
// vitest hoists vi.mock above the imports below.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ meteredMessage: vi.fn() }))
vi.mock('@/lib/catering/filter', () => ({
  hasCatering: vi.fn(),
  filterCateringItems: vi.fn(),
}))
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

import { draftCateringOrders, draftTomorrowSchedule } from './ops-drafters'
import { createAdminClient } from '@/lib/supabase/admin'
import { meteredMessage } from '@/lib/ai/usage'
import { hasCatering, filterCateringItems } from '@/lib/catering/filter'

const TODAY = '2026-06-13'
const TOMORROW = '2026-06-14'

/**
 * Chainable Supabase stub. `queues` is keyed by table name; each chain that
 * ends in an await (`.limit()`, `.order()`, `.eq()`, …) shifts the next result
 * off that table's queue. `.insert()` is captured (not queued) so we can assert
 * exactly what the drafter persists.
 */
function makeSupabase(queues: Record<string, Array<{ data: unknown }>> = {}) {
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
        return Promise.resolve({ data: null, error: null })
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
})

// ── schedule_day (captain assignments) ───────────────────────────────────────

describe('draftTomorrowSchedule', () => {
  const openShift = { id: 's1', date: TOMORROW, start_at: '2026-06-14T15:00:00Z', end_at: '2026-06-14T17:00:00Z', status: 'open', staff_id: null, boats: { name: 'Diana' }, bookings: { listing_title: 'Sunset', guest_count: 6 } }
  const activeStaff = { id: 'cap1', name: 'Sanne', role: 'captain', max_shifts_per_week: 5, is_active: true }

  it('skips (no Claude call) when a schedule proposal already exists for tomorrow', async () => {
    const sb = makeSupabase({ agent_proposals: [{ data: [{ id: 'existing' }] }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftTomorrowSchedule()).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('skips (no Claude call) when there are no OPEN shifts to fill', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [{ data: [{ ...openShift, status: 'assigned' }] }], // all already assigned
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftTomorrowSchedule()).toBe('skipped')
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

    expect(await draftTomorrowSchedule()).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('drafts a shadow schedule_day proposal for tomorrow on the happy path', async () => {
    const sb = makeSupabase({
      agent_proposals: [{ data: [] }],
      shifts: [{ data: [openShift] }, { data: [] }], // tomorrow's shifts, then recent-workload query
      staff: [{ data: [activeStaff] }],
      staff_availability: [{ data: [{ staff_id: 'cap1', status: 'available', note: null }] }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({ assignments: [{ shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne', reason: 'Available and rested.' }], summary: 'Sanne takes the only open shift.' }) as never,
    )

    expect(await draftTomorrowSchedule()).toBe('drafted')

    expect(sb.inserts).toHaveLength(1)
    const { row } = sb.inserts[0]
    expect(row.kind).toBe('schedule_day')
    expect(row.status).toBe('shadow')
    expect((row.payload as { target_date: string }).target_date).toBe(TOMORROW)
    expect((row.payload as { assignments: unknown[] }).assignments).toEqual([
      { shift_id: 's1', staff_id: 'cap1', staff_name: 'Sanne', reason: 'Available and rested.' },
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

    expect(await draftTomorrowSchedule()).toBe('skipped')
    expect(sb.inserts).toHaveLength(0)
  })

  it('swallows errors (returns skipped, never throws)', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('DB exploded')
    })
    await expect(draftTomorrowSchedule()).resolves.toBe('skipped')
  })
})
