import { describe, it, expect } from 'vitest'
import { accrueSkipperHours, buildPayoutRun, type SkipperRate, type SkipperShift, type SkipperTimeEntry } from './skipper-hours'

const TODAY = '2026-09-04'

const staff: SkipperRate[] = [
  { id: 'jannah', name: 'Jannah Schenk', hourlyRateCents: 3500, isActive: true },
  { id: 'joshua', name: 'Joshua', hourlyRateCents: 3250, isActive: true },
  { id: 'bo', name: 'Bo', hourlyRateCents: 0, isActive: true },
]

const shift = (o: Partial<SkipperShift>): SkipperShift => ({
  id: 's1', staffId: 'jannah', date: '2026-08-10',
  startAt: '2026-08-10T12:00:00Z', endAt: '2026-08-10T15:00:00Z', status: 'assigned', ...o,
})

const entry = (o: Partial<SkipperTimeEntry>): SkipperTimeEntry => ({
  id: 'e1', staffId: 'jannah', shiftId: 's1',
  clockInAt: '2026-08-10T12:00:00Z', clockOutAt: '2026-08-10T16:00:00Z', hourlyRateCents: 3500, ...o,
})

const run = (shifts: SkipperShift[], entries: SkipperTimeEntry[] = [], bonuses: Parameters<typeof accrueSkipperHours>[2] = []) =>
  accrueSkipperHours(shifts, entries, bonuses, staff, { today: TODAY })

describe('accrueSkipperHours — a sailed shift is a debt', () => {
  it('prices a planned shift at the skipper current rate', () => {
    const r = run([shift({})])
    expect(r.months).toHaveLength(1)
    expect(r.months[0]).toMatchObject({ month: '2026-08', staffName: 'Jannah Schenk', hours: 3, amountCents: 10_500, shiftsCounted: 1 })
    expect(r.totalOwedCents).toBe(10_500)
  })

  it('pays the month out a week after it ends', () => {
    expect(run([shift({})]).months[0]).toMatchObject({ dueDate: '2026-09-07', isClosed: true })
  })

  it('leaves a shift that has not happened yet out of the debt', () => {
    expect(run([shift({ date: '2026-09-20', startAt: '2026-09-20T12:00:00Z', endAt: '2026-09-20T15:00:00Z' })]).months).toEqual([])
  })

  it('ignores a cancelled shift', () => {
    expect(run([shift({ status: 'cancelled' })]).months).toEqual([])
  })
})

describe('accrueSkipperHours — clocked hours beat planned hours', () => {
  it('uses the time entry and does not also count its shift', () => {
    const r = run([shift({})], [entry({})])
    expect(r.months[0]).toMatchObject({ hours: 4, amountCents: 14_000, timeEntriesCounted: 1, shiftsCounted: 0 })
  })

  it('uses the rate frozen at clock-in, not today\'s rate', () => {
    const r = run([shift({})], [entry({ hourlyRateCents: 3000 })])
    expect(r.months[0].amountCents).toBe(12_000)
  })

  it('falls back to the planned shift when someone forgot to clock out', () => {
    const r = run([shift({})], [entry({ clockOutAt: null })])
    expect(r.warnings.openTimeEntries).toBe(1)
    expect(r.months[0]).toMatchObject({ hours: 3, shiftsCounted: 1, timeEntriesCounted: 0 })
  })
})

describe('accrueSkipperHours — grouping and bonuses', () => {
  it('groups per skipper per month', () => {
    const r = run([
      shift({ id: 'a', staffId: 'jannah', date: '2026-08-10' }),
      shift({ id: 'b', staffId: 'jannah', date: '2026-08-20', startAt: '2026-08-20T12:00:00Z', endAt: '2026-08-20T14:00:00Z' }),
      shift({ id: 'c', staffId: 'joshua', date: '2026-08-15', startAt: '2026-08-15T12:00:00Z', endAt: '2026-08-15T16:00:00Z' }),
      shift({ id: 'd', staffId: 'jannah', date: '2026-07-05', startAt: '2026-07-05T12:00:00Z', endAt: '2026-07-05T15:00:00Z' }),
    ])
    expect(r.months.map(m => `${m.month}/${m.staffName}`)).toEqual([
      '2026-07/Jannah Schenk', '2026-08/Jannah Schenk', '2026-08/Joshua',
    ])
    expect(r.months.find(m => m.month === '2026-08' && m.staffId === 'jannah')!.hours).toBe(5)
  })

  it('adds an upsell commission to the same month', () => {
    const r = run([shift({})], [], [{ id: 'b1', staffId: 'jannah', date: '2026-08-12', commissionCents: 2_500 }])
    expect(r.months[0]).toMatchObject({ bonusCents: 2_500, amountCents: 13_000 })
  })

  it('skips months that were already settled', () => {
    const r = accrueSkipperHours([shift({})], [], [], staff, { today: TODAY, settledMonths: ['2026-08'] })
    expect(r.months).toEqual([])
  })
})

describe('accrueSkipperHours — being honest about gaps', () => {
  it('counts hours for a skipper without a rate but never pretends they cost nothing', () => {
    const r = run([shift({ staffId: 'bo' })])
    expect(r.months[0]).toMatchObject({ hours: 3, amountCents: 0, unpricedHours: 3 })
    expect(r.warnings.staffWithoutRate).toEqual(['Bo'])
  })

  it('reports shifts nobody was assigned to instead of silently dropping them', () => {
    const r = run([shift({ staffId: null })])
    expect(r.warnings.unassignedShifts).toBe(1)
    expect(r.months).toEqual([])
  })

  it('names an unknown skipper rather than failing', () => {
    expect(run([shift({ staffId: 'schipper-mg' })]).months[0].staffName).toBe('Onbekende schipper')
  })
})

describe('buildPayoutRun', () => {
  const result = run([
    shift({ id: 'a', staffId: 'jannah' }),
    shift({ id: 'b', staffId: 'joshua', startAt: '2026-08-15T12:00:00Z', endAt: '2026-08-15T16:00:00Z', date: '2026-08-15' }),
    shift({ id: 'c', staffId: 'bo', date: '2026-08-18', startAt: '2026-08-18T12:00:00Z', endAt: '2026-08-18T14:00:00Z' }),
  ])

  it('turns one month into the lines of a single payment draft', () => {
    const runOut = buildPayoutRun(result, '2026-08')
    expect(runOut.lines).toHaveLength(2)
    expect(runOut.lines.map(l => l.staffName)).toEqual(['Jannah Schenk', 'Joshua'])
    expect(runOut.totalCents).toBe(10_500 + 13_000)
    expect(runOut.lines[0].reference).toBe('Uren 2026-08 (3 uur)')
  })

  it('holds back a skipper whose hours cannot be priced instead of paying them nothing', () => {
    const runOut = buildPayoutRun(result, '2026-08')
    expect(runOut.blocked).toEqual([{ staffId: 'bo', staffName: 'Bo', reason: '2 uur zonder uurtarief' }])
    expect(runOut.lines.map(l => l.staffId)).not.toContain('bo')
  })

  it('is empty for a month with nothing in it', () => {
    expect(buildPayoutRun(result, '2026-05')).toMatchObject({ lines: [], totalCents: 0, blocked: [] })
  })
})
