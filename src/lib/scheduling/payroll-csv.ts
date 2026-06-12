import { entryMinutes, entryPayCents, type PayrollStaff } from './payroll'

/**
 * Build a per-entry payroll CSV (one row per time entry). Designed to hand
 * straight to a bookkeeper: amounts in euros, times in Amsterdam local, and
 * a Flag column so flagged/auto-closed rows are easy to eyeball before paying.
 */

export interface CsvTimeEntry {
  id: string
  staff_id: string
  clock_in_at: string
  clock_out_at: string | null
  hourly_rate_cents: number
  flag: string | null
  source: string
  note: string | null
}

/** RFC-4180 field escaping: quote when the value has comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const AMS = 'Europe/Amsterdam'

function amsDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: AMS }) // YYYY-MM-DD
}
function amsTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit', minute: '2-digit', timeZone: AMS,
  })
}
function euros(cents: number): string {
  return (cents / 100).toFixed(2)
}

const HEADERS = [
  'Staff', 'Role', 'Date', 'Clock in', 'Clock out',
  'Hours', 'Rate (EUR)', 'Pay (EUR)', 'Source', 'Flag', 'Note',
]

export function buildPayrollCsv(entries: CsvTimeEntry[], staff: PayrollStaff[]): string {
  const byId = new Map(staff.map(s => [s.id, s]))
  const rows: string[] = [HEADERS.join(',')]

  for (const e of entries) {
    const s = byId.get(e.staff_id)
    const minutes = entryMinutes(e)
    const hours = minutes === null ? '' : (minutes / 60).toFixed(2)
    const pay = minutes === null ? '' : euros(entryPayCents(e))

    const row = [
      s?.name ?? 'Unknown',
      s?.role ?? '',
      amsDate(e.clock_in_at),
      amsTime(e.clock_in_at),
      e.clock_out_at ? amsTime(e.clock_out_at) : '(open)',
      hours,
      euros(e.hourly_rate_cents),
      pay,
      e.source,
      e.flag ?? '',
      e.note ?? '',
    ]
    rows.push(row.map(v => csvField(String(v))).join(','))
  }

  return rows.join('\r\n')
}
