import { describe, it, expect } from 'vitest'
import { checkClaimedShiftsAgainstPlanning, resolveStaffForInvoice } from './skipper-shifts'

describe('resolveStaffForInvoice', () => {
  it('resolves staff by exact name', async () => {
    const supabase = {
      from: () => ({
        select: () => Promise.resolve({
          data: [
            { id: 'st-1', name: 'Olivier van Dommele', email: 'onvandommele@gmail.com', payment_aliases: [] },
            { id: 'st-2', name: 'Gijs de Graaf', email: 'gijs@graaf.nl', payment_aliases: ['GIJSBOTS'] },
          ],
        }),
      }),
    } as never

    const res = await resolveStaffForInvoice(supabase, { supplierName: 'Olivier van Dommele' })
    expect(res).toEqual({ id: 'st-1', name: 'Olivier van Dommele' })
  })

  it('resolves staff by alias or fuzzy match (e.g. GIJSBOTS)', async () => {
    const supabase = {
      from: () => ({
        select: () => Promise.resolve({
          data: [
            { id: 'st-1', name: 'Bram Bots', email: 'brambots@gmail.com', payment_aliases: ['B.A. Bots'] },
            { id: 'st-2', name: 'Gijs de Graaf', email: 'gijs@graaf.nl', payment_aliases: [] },
          ],
        }),
      }),
    } as never

    // "GIJSBOTS" matches "Gijs" or "Bots"
    const res = await resolveStaffForInvoice(supabase, { supplierName: 'GIJSBOTS' })
    expect(res).toBeDefined()
    expect(['st-1', 'st-2']).toContain(res?.id)
  })
})

describe('checkClaimedShiftsAgainstPlanning', () => {
  it('marks planned shifts with green check and unplanned shifts with warning ⚠️', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'staff') {
          return {
            select: () => Promise.resolve({
              data: [
                { id: 'staff-gijs', name: 'Gijs de Graaf', email: 'gijs@test.nl', payment_aliases: ['GIJSBOTS'] },
              ],
            }),
          }
        }
        if (table === 'shifts') {
          return {
            select: () => ({
              in: () => Promise.resolve({
                data: [
                  {
                    id: 'sh-1',
                    date: '2026-08-25',
                    start_at: '2026-08-25T14:15:00Z',
                    end_at: '2026-08-25T17:30:00Z',
                    status: 'assigned',
                    staff_id: 'other-staff',
                    staff: { name: 'Jannah Schenk' },
                  },
                  {
                    id: 'sh-2',
                    date: '2026-09-05',
                    start_at: '2026-09-05T08:30:00Z',
                    end_at: '2026-09-05T14:30:00Z',
                    status: 'assigned',
                    staff_id: 'staff-gijs',
                    staff: { name: 'Gijs de Graaf' },
                  },
                ],
              }),
            }),
          }
        }
        return {}
      },
    } as never

    const res = await checkClaimedShiftsAgainstPlanning(supabase, {
      supplierName: 'GIJSBOTS',
      lineItems: [
        { description: 'Vaartocht 25 aug', date: '2026-08-25', hours: 6 },
        { description: 'Vaartocht 5 sep', date: '2026-09-05', hours: 6 },
      ],
    })

    expect(res).not.toBeNull()
    expect(res?.staffName).toBe('Gijs de Graaf')
    expect(res?.allMatched).toBe(false)
    expect(res?.unmatchedCount).toBe(1)

    // 2026-08-25: not planned for Gijs (Jannah was scheduled)
    expect(res?.items[0]).toMatchObject({
      date: '2026-08-25',
      hasScheduledShift: false,
    })
    expect(res?.items[0]?.warning).toContain('Geen dienst gevonden voor Gijs de Graaf')

    // 2026-09-05: planned for Gijs
    expect(res?.items[1]).toMatchObject({
      date: '2026-09-05',
      hasScheduledShift: true,
      scheduledDetails: expect.stringContaining('Ingepland'),
    })
  })
})
