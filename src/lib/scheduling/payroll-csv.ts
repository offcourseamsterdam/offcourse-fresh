import { formatAmsterdamTime } from '@/lib/utils'
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

/** A review bonus earned in the period (one row per mention; €5 each). */
export interface CsvBonus {
  staff_id: string
  amount_cents: number
}

/** RFC-4180 field escaping: quote when the value has comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function amsDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' }) // YYYY-MM-DD
}
function euros(cents: number): string {
  return (cents / 100).toFixed(2)
}

const HEADERS = [
  'Staff', 'Role', 'Date', 'Clock in', 'Clock out',
  'Hours', 'Rate (EUR)', 'Pay (EUR)', 'Source', 'Flag', 'Note',
]

export function buildPayrollCsv(
  entries: CsvTimeEntry[],
  staff: PayrollStaff[],
  bonuses: CsvBonus[] = [],
): string {
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
      formatAmsterdamTime(e.clock_in_at),
      e.clock_out_at ? formatAmsterdamTime(e.clock_out_at) : '(open)',
      hours,
      euros(e.hourly_rate_cents),
      pay,
      e.source,
      e.flag ?? '',
      e.note ?? '',
    ]
    rows.push(row.map(v => csvField(String(v))).join(','))
  }

  // Review bonuses — one summary row per staff member who earned any in the
  // period. Without these the Pay column under-totals the on-screen payroll
  // (which folds bonuses into each staffer's Total), so a bookkeeper paying off
  // the CSV would silently underpay by exactly the bonus amount.
  const bonusByStaff = new Map<string, { total: number; count: number }>()
  for (const b of bonuses) {
    const agg = bonusByStaff.get(b.staff_id) ?? { total: 0, count: 0 }
    agg.total += b.amount_cents
    agg.count += 1
    bonusByStaff.set(b.staff_id, agg)
  }

  const bonusLines = [...bonusByStaff.entries()]
    .map(([staffId, agg]) => {
      const s = byId.get(staffId)
      return { name: s?.name ?? 'Unknown', role: s?.role ?? '', ...agg }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const bl of bonusLines) {
    const row = [
      bl.name,
      bl.role,
      '',                              // Date
      '',                              // Clock in
      '',                              // Clock out
      '',                              // Hours
      '',                              // Rate
      euros(bl.total),                 // Pay (the bonus total)
      'review_bonus',                  // Source
      '',                              // Flag
      `${bl.count} review mention${bl.count === 1 ? '' : 's'}`, // Note
    ]
    rows.push(row.map(v => csvField(String(v))).join(','))
  }

  return rows.join('\r\n')
}
