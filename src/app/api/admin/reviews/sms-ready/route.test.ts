import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  bookings: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  ownShifts: [] as { booking_id: string; staff_id: string }[],
  staffRows: [] as { id: string; name: string }[],
}))

vi.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return {
          select: () => ({
            in: () => ({
              is: () => ({
                not: () => ({
                  lte: () => ({
                    gte: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: state.bookings, error: state.error }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'shifts') {
        return {
          select: (fields: string) => {
            if (fields.includes('booking_id')) {
              return { in: () => ({ not: () => Promise.resolve({ data: state.ownShifts }) }) }
            }
            return { in: () => ({ not: () => Promise.resolve({ data: [] }) }) }
          },
        }
      }
      if (table === 'staff') {
        return { select: () => ({ in: () => Promise.resolve({ data: state.staffRows }) }) }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

describe('GET /api/admin/reviews/sms-ready', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.bookings = []
    state.error = null
    state.ownShifts = []
    state.staffRows = []
  })

  it('returns the eligible bookings list', async () => {
    state.bookings = [
      { id: 'b1', customer_name: 'Anna Smith', customer_phone: '0612345678', listing_title: 'Sunset Cruise', end_time: '2026-08-26T18:30:00Z', booking_date: '2026-08-26', fareharbor_availability_pk: null },
    ]
    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data.bookings).toHaveLength(1)
    expect(json.data.bookings[0].customer_name).toBe('Anna Smith')
    expect(json.data.bookings[0].captain_name).toBeNull()
  })

  it('includes the assigned captain\'s first name when resolvable', async () => {
    state.bookings = [
      { id: 'b1', customer_name: 'Anna Smith', customer_phone: '0612345678', listing_title: 'Sunset Cruise', end_time: '2026-08-26T18:30:00Z', booking_date: '2026-08-26', fareharbor_availability_pk: null },
    ]
    state.ownShifts = [{ booking_id: 'b1', staff_id: 's1' }]
    state.staffRows = [{ id: 's1', name: 'Jannah Schenk' }]

    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(json.data.bookings[0].captain_name).toBe('Jannah')
  })

  it('returns an empty list when nothing is eligible', async () => {
    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.data.bookings).toEqual([])
  })

  it('returns a 500 with a safe message on a query error', async () => {
    state.error = { message: 'column "review_sms_sent_at" does not exist' }
    const { GET } = await import('./route')
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.ok).toBe(false)
    expect(json.error).toBe('Failed to load ready-to-send bookings')
  })
})
