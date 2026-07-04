import { describe, it, expect } from 'vitest'
import { buildPayrollCsv, type CsvTimeEntry } from './payroll-csv'
import { entryPayCents, type PayrollStaff } from './payroll'

const staff: PayrollStaff[] = [
  { id: 's1', name: 'Joris', role: 'skipper' },
]

/** Sum the Pay (EUR) column across all rows — the figure a bookkeeper pays. */
function sumPayColumn(csv: string): number {
  const lines = csv.split('\r\n').slice(1) // drop header
  return lines.reduce((sum, line) => {
    const pay = line.split(',')[7] // Pay (EUR) is the 8th column
    return sum + (pay ? Number(pay) : 0)
  }, 0)
}

function entry(over: Partial<CsvTimeEntry> = {}): CsvTimeEntry {
  return {
    id: 'e1',
    staff_id: 's1',
    clock_in_at: '2026-06-01T08:00:00.000Z', // 10:00 Amsterdam (CEST)
    clock_out_at: '2026-06-01T10:00:00.000Z', // 12:00 Amsterdam
    hourly_rate_cents: 2000,
    flag: null,
    source: 'portal',
    note: null,
    ...over,
  }
}

describe('buildPayrollCsv', () => {
  it('starts with the header row', () => {
    const csv = buildPayrollCsv([], staff)
    expect(csv.split('\r\n')[0]).toBe(
      'Staff,Role,Date,Clock in,Clock out,Hours,Rate (EUR),Pay (EUR),Source,Flag,Note',
    )
  })

  it('renders a closed entry with hours and pay in euros', () => {
    const csv = buildPayrollCsv([entry()], staff)
    const row = csv.split('\r\n')[1]
    expect(row).toContain('Joris,skipper,2026-06-01,10:00,12:00,2.00,20.00,40.00,portal,,')
  })

  it('marks an open entry and leaves hours/pay blank', () => {
    const csv = buildPayrollCsv([entry({ clock_out_at: null })], staff)
    const row = csv.split('\r\n')[1]
    expect(row).toContain('(open)')
    // hours and pay columns empty
    expect(row).toContain(',,20.00,,portal')
  })

  it('includes the flag column', () => {
    const csv = buildPayrollCsv([entry({ flag: 'auto_closed' })], staff)
    expect(csv.split('\r\n')[1]).toContain('auto_closed')
  })

  it('escapes notes containing commas and quotes', () => {
    const csv = buildPayrollCsv([entry({ note: 'late, said "sorry"' })], staff)
    expect(csv.split('\r\n')[1]).toContain('"late, said ""sorry"""')
  })

  it('falls back to Unknown for a missing staff record', () => {
    const csv = buildPayrollCsv([entry({ staff_id: 'ghost' })], staff)
    expect(csv.split('\r\n')[1]).toContain('Unknown,,')
  })

  it('appends a per-staff review-bonus summary row', () => {
    const csv = buildPayrollCsv([entry()], staff, [
      { staff_id: 's1', amount_cents: 500 },
      { staff_id: 's1', amount_cents: 500 },
    ])
    const last = csv.split('\r\n').at(-1)!
    // Pay column = €10.00, source review_bonus, note names the count
    expect(last).toBe('Joris,skipper,,,,,,10.00,review_bonus,,2 review mentions')
  })

  it('singularises the note for a single mention', () => {
    const csv = buildPayrollCsv([], staff, [{ staff_id: 's1', amount_cents: 500 }])
    expect(csv.split('\r\n').at(-1)).toContain('1 review mention')
  })

  it('omits bonus rows entirely when there are none', () => {
    const csv = buildPayrollCsv([entry()], staff)
    expect(csv).not.toContain('review_bonus')
  })

  it('CSV Pay total reconciles with hours-pay + bonuses (the screen Total)', () => {
    const entries = [entry(), entry({ id: 'e2', hourly_rate_cents: 3000 })]
    const bonuses = [
      { staff_id: 's1', amount_cents: 500 },
      { staff_id: 's1', amount_cents: 500 },
    ]
    const csv = buildPayrollCsv(entries, staff, bonuses)

    const hoursPay = entries.reduce((s, e) => s + entryPayCents(e), 0)
    const bonusPay = bonuses.reduce((s, b) => s + b.amount_cents, 0)
    const expectedTotal = (hoursPay + bonusPay) / 100

    expect(sumPayColumn(csv)).toBeCloseTo(expectedTotal, 2)
  })
})
