import { describe, it, expect } from 'vitest'
import { buildPayrollCsv, type CsvTimeEntry } from './payroll-csv'
import type { PayrollStaff } from './payroll'

const staff: PayrollStaff[] = [
  { id: 's1', name: 'Joris', role: 'skipper' },
]

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
})
