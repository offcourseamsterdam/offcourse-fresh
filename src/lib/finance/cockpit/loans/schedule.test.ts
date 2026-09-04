import { describe, it, expect } from 'vitest'
import { buildSchedule, nextPaymentDate, scheduleByYear, outstandingOn, type LoanTerms } from './schedule'

// Oracle: the six real loans exported from the Investment Tracker on 2026-09-04
// (docs/plans/2026-09-04-financial-management-module.md §2.2 / loancashflowexport.md).
// Amounts in the export are whole euros; we compare in euros after rounding cents.
const eur = (cents: number) => Math.round(cents / 100)

const byYear = (loan: LoanTerms) =>
  Object.fromEntries(scheduleByYear(buildSchedule(loan)).map(r => [r.year, { i: eur(r.interestCents), p: eur(r.principalCents), t: eur(r.totalCents) }]))

const linear6 = (over: Partial<LoanTerms>): LoanTerms => ({
  principalCents: 0,
  interestRatePct: 6,
  durationYears: 5,
  interestFreeYears: 2,
  repaymentType: 'linear',
  startDate: '2025-01-01',
  ...over,
})

describe('nextPaymentDate — fixed 1 April / 1 October calendar, strictly after start', () => {
  it('mid-period start goes to the next fixed date', () => {
    expect(nextPaymentDate('2025-05-25')).toBe('2025-10-01')
    expect(nextPaymentDate('2026-03-02')).toBe('2026-04-01')
    expect(nextPaymentDate('2025-11-15')).toBe('2026-04-01')
  })
  it('a start exactly on a payment date pays first on the following one (Erik Musegaas: 2026-04-01 → 2026-10-01)', () => {
    expect(nextPaymentDate('2026-04-01')).toBe('2026-10-01')
    expect(nextPaymentDate('2026-10-01')).toBe('2027-04-01')
  })
})

describe('buildSchedule — reproduces the Investment Tracker export', () => {
  it('Tijs Louman: €6.000, 2y, fully interest-free → pro-rata first period + bullet', () => {
    const loan = linear6({ principalCents: 600000, durationYears: 2, interestFreeYears: 2, startDate: '2025-05-25' })
    const s = buildSchedule(loan)
    expect(s.endDate).toBe('2027-04-01')
    expect(byYear(loan)).toEqual({
      2025: { i: 127, p: 0, t: 127 },
      2026: { i: 360, p: 0, t: 360 },
      2027: { i: 180, p: 6000, t: 6180 },
    })
    expect(eur(s.totalInterestCents)).toBe(667)
    expect(eur(s.totalPaidCents)).toBe(6667)
  })

  it('Jelka Wittebol: €3.000, 5y, 2y interest-free, linear', () => {
    const loan = linear6({ principalCents: 300000, startDate: '2025-06-01' })
    expect(buildSchedule(loan).endDate).toBe('2030-04-01')
    expect(byYear(loan)).toEqual({
      2025: { i: 60, p: 0, t: 60 },
      2026: { i: 180, p: 0, t: 180 },
      2027: { i: 180, p: 500, t: 680 },
      2028: { i: 135, p: 1000, t: 1135 },
      2029: { i: 75, p: 1000, t: 1075 },
      2030: { i: 15, p: 500, t: 515 },
    })
    // Upcoming rows the dashboard will show
    const periods = buildSchedule(loan).periods.filter(p => p.dueDate >= '2026-10-01').slice(0, 4)
    expect(periods.map(p => [p.dueDate, eur(p.interestCents), eur(p.principalCents)])).toEqual([
      ['2026-10-01', 90, 0],
      ['2027-04-01', 90, 0],
      ['2027-10-01', 90, 500],
      ['2028-04-01', 75, 500],
    ])
  })

  it('Irma Blackmore: €30.000, 10y with interestFreeYears == durationYears → pure bullet', () => {
    const loan = linear6({ principalCents: 3000000, durationYears: 10, interestFreeYears: 10, startDate: '2025-06-11' })
    const s = buildSchedule(loan)
    expect(s.endDate).toBe('2035-04-01')
    const y = byYear(loan)
    expect(y[2025]).toEqual({ i: 551, p: 0, t: 551 })
    for (let yr = 2026; yr <= 2034; yr++) expect(y[yr]).toEqual({ i: 1800, p: 0, t: 1800 })
    expect(y[2035]).toEqual({ i: 900, p: 30000, t: 30900 })
    expect(eur(s.totalInterestCents)).toBe(17651)
    expect(eur(s.totalPaidCents)).toBe(47651)
    // never a negative or leftover balance
    expect(s.periods.at(-1)?.closingBalanceCents).toBe(0)
  })

  it('Erik Musegaas: €83.125 starting exactly on 1 April → first period is a full 1 October period', () => {
    const loan = linear6({ principalCents: 8312500, startDate: '2026-04-01' })
    const s = buildSchedule(loan)
    expect(s.periods[0].dueDate).toBe('2026-10-01')
    expect(s.endDate).toBe('2031-04-01')
    expect(byYear(loan)).toEqual({
      2026: { i: 2494, p: 0, t: 2494 },
      2027: { i: 4988, p: 0, t: 4988 },
      2028: { i: 4988, p: 13854, t: 18842 },
      2029: { i: 3741, p: 27708, t: 31449 },
      2030: { i: 2078, p: 27708, t: 29786 },
      2031: { i: 416, p: 13854, t: 14270 },
    })
    expect(eur(s.totalInterestCents)).toBe(18703)
    expect(eur(s.totalPaidCents)).toBe(101828)
  })

  it('Expres Wijn B.V.: €60.000 starting 2 March → 30/182 pro-rata first period', () => {
    const loan = linear6({ principalCents: 6000000, startDate: '2026-03-02' })
    const s = buildSchedule(loan)
    expect(s.endDate).toBe('2030-10-01')
    expect(byYear(loan)).toEqual({
      2026: { i: 2097, p: 0, t: 2097 },
      2027: { i: 3600, p: 0, t: 3600 },
      2028: { i: 3300, p: 20000, t: 23300 },
      2029: { i: 2100, p: 20000, t: 22100 },
      2030: { i: 900, p: 20000, t: 20900 },
    })
    expect(eur(s.totalInterestCents)).toBe(11997)
  })

  it('Enrico Erkelens: two tranches → day-accurate segmented interest, principal on the total', () => {
    const loan = linear6({
      principalCents: 3000000,
      startDate: '2025-09-25',
      tranches: [
        { amountCents: 1000000, date: '2025-09-25' },
        { amountCents: 2000000, date: '2026-03-05' },
      ],
    })
    const s = buildSchedule(loan)
    expect(s.endDate).toBe('2030-04-01')
    const y = byYear(loan)
    // 2025: €10.000 out for 6 days → €10
    expect(y[2025]).toEqual({ i: 10, p: 0, t: 10 })
    // 2026: the export says €1.292; we say €1.290. The Investment Tracker measured the
    // Oct→Mar segment with a DST-affected millisecond diff rounded UP (156 days instead
    // of 155). Calendar days are correct, so we accept the €2 difference knowingly.
    expect(y[2026].i).toBeGreaterThanOrEqual(1290)
    expect(y[2026].i).toBeLessThanOrEqual(1292)
    expect(y[2026].p).toBe(0)
    expect(y[2027]).toEqual({ i: 1800, p: 5000, t: 6800 })
    expect(y[2028]).toEqual({ i: 1354, p: 10000, t: 11354 })
    expect(y[2029]).toEqual({ i: 750, p: 10000, t: 10750 })
    expect(y[2030]).toEqual({ i: 150, p: 5000, t: 5150 })
    // Individual upcoming rows from the export
    const rows = s.periods.filter(p => p.dueDate >= '2026-10-01').slice(0, 4)
    expect(rows.map(p => [p.dueDate, eur(p.interestCents), eur(p.principalCents)])).toEqual([
      ['2026-10-01', 902, 0],
      ['2027-04-01', 898, 0],
      ['2027-10-01', 902, 5000],
      ['2028-04-01', 752, 5000],
    ])
  })

  it('tranches must add up to the principal', () => {
    expect(() => buildSchedule(linear6({ principalCents: 100, tranches: [{ amountCents: 50, date: '2025-01-01' }] }))).toThrow(/add up/)
  })
})

describe('annuity + interest-only', () => {
  it('annuity: equal total payments over the repayment periods, balance ends at zero', () => {
    const s = buildSchedule({ principalCents: 1000000, interestRatePct: 6, durationYears: 2, interestFreeYears: 0, repaymentType: 'annuity', startDate: '2025-10-01' })
    expect(s.periods).toHaveLength(4)
    const totals = s.periods.map(p => p.totalCents)
    // all payments equal (± rounding), last sweeps the remainder
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(5)
    expect(s.periods.at(-1)?.closingBalanceCents).toBe(0)
    expect(s.periods.reduce((a, p) => a + p.principalCents, 0)).toBe(1000000)
  })

  it('interest-only: interest every period, principal only in the last', () => {
    const s = buildSchedule({ principalCents: 500000, interestRatePct: 4, durationYears: 1, interestFreeYears: 0, repaymentType: 'interest_only', startDate: '2025-10-01' })
    expect(s.periods.map(p => p.principalCents)).toEqual([0, 500000])
    expect(s.periods.map(p => p.interestCents)).toEqual([10000, 10000])
  })
})

describe('outstandingOn', () => {
  it('follows the schedule', () => {
    const s = buildSchedule(linear6({ principalCents: 300000, startDate: '2025-06-01' }))
    expect(outstandingOn(s, '2026-09-04')).toBe(300000)
    expect(outstandingOn(s, '2027-10-01')).toBe(250000)
    expect(outstandingOn(s, '2030-04-01')).toBe(0)
  })
})

describe('portfolio totals used in the plan (§2.2)', () => {
  it('upcoming payment dates across all six loans', () => {
    const loans: LoanTerms[] = [
      linear6({ principalCents: 600000, durationYears: 2, interestFreeYears: 2, startDate: '2025-05-25' }),
      linear6({ principalCents: 300000, startDate: '2025-06-01' }),
      linear6({ principalCents: 3000000, durationYears: 10, interestFreeYears: 10, startDate: '2025-06-11' }),
      linear6({ principalCents: 8312500, startDate: '2026-04-01' }),
      linear6({ principalCents: 6000000, startDate: '2026-03-02' }),
      linear6({ principalCents: 3000000, startDate: '2025-09-25', tranches: [{ amountCents: 1000000, date: '2025-09-25' }, { amountCents: 2000000, date: '2026-03-05' }] }),
    ]
    // Summed per loan in whole euros, the way the export (and the plan) lists them.
    const sum = (date: string) => loans.reduce((s, l) => s + eur(buildSchedule(l).periods.find(p => p.dueDate === date)?.totalCents ?? 0), 0)
    expect(sum('2026-10-01')).toBe(6366)
    expect(sum('2027-04-01')).toBe(12362)
    expect(sum('2027-10-01')).toBe(11686)
    expect(sum('2028-04-01')).toBe(21521)
  })
})
