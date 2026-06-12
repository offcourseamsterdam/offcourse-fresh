/**
 * Payroll math — pure functions, no I/O. Turns the time_entries ledger into
 * per-staff totals an admin can review and export.
 *
 * Two rules that keep payroll honest:
 *  1. Pay uses the entry's SNAPSHOT rate (hourly_rate_cents on the row), never
 *     the staff's current rate — a raise today doesn't reprice last month.
 *  2. Open entries (no clock_out) earn nothing yet and are counted separately
 *     so they show up as "needs attention" instead of silently inflating hours.
 */

export interface PayrollTimeEntry {
  id: string
  staff_id: string
  clock_in_at: string
  clock_out_at: string | null
  hourly_rate_cents: number
  flag: string | null
}

export interface PayrollStaff {
  id: string
  name: string
  role: string
}

export interface PayrollLine {
  staffId: string
  name: string
  role: string
  entryCount: number
  /** Entries still clocked in (no clock_out) — earn nothing yet. */
  openCount: number
  /** Entries carrying a review flag (auto_closed, overlong, …). */
  flaggedCount: number
  /** Worked minutes across CLOSED entries only. */
  totalMinutes: number
  /** Pay in cents across closed entries, using each entry's snapshot rate. */
  totalPayCents: number
}

/** Worked minutes for one entry, or null if it's still open. */
export function entryMinutes(entry: PayrollTimeEntry): number | null {
  if (!entry.clock_out_at) return null
  const start = new Date(entry.clock_in_at).getTime()
  const end = new Date(entry.clock_out_at).getTime()
  const ms = end - start
  if (ms <= 0) return 0
  return Math.round(ms / 60000)
}

/** Pay in cents for one entry (0 while open). Rounds to the nearest cent. */
export function entryPayCents(entry: PayrollTimeEntry): number {
  const minutes = entryMinutes(entry)
  if (minutes === null) return 0
  return Math.round((minutes / 60) * entry.hourly_rate_cents)
}

/**
 * Aggregate entries into one line per staff member. Staff with no entries in
 * the range are omitted. Lines are sorted by name for stable display/export.
 */
export function aggregatePayroll(
  entries: PayrollTimeEntry[],
  staff: PayrollStaff[],
): PayrollLine[] {
  const byId = new Map<string, PayrollStaff>(staff.map(s => [s.id, s]))
  const lines = new Map<string, PayrollLine>()

  for (const entry of entries) {
    let line = lines.get(entry.staff_id)
    if (!line) {
      const s = byId.get(entry.staff_id)
      line = {
        staffId: entry.staff_id,
        name: s?.name ?? 'Unknown',
        role: s?.role ?? '—',
        entryCount: 0,
        openCount: 0,
        flaggedCount: 0,
        totalMinutes: 0,
        totalPayCents: 0,
      }
      lines.set(entry.staff_id, line)
    }

    line.entryCount++
    if (entry.flag) line.flaggedCount++

    const minutes = entryMinutes(entry)
    if (minutes === null) {
      line.openCount++
    } else {
      line.totalMinutes += minutes
      line.totalPayCents += entryPayCents(entry)
    }
  }

  return [...lines.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** "8h 05m" from a minute count. */
export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

/**
 * When to auto-close a forgotten clock-in. Prefer the matched shift's end
 * time; otherwise cap the entry at maxHours past clock-in so a captain who
 * forgot to check out doesn't bank an open-ended day. Never returns a time
 * before clock-in.
 */
export function computeAutoCloseAt(
  clockInAt: string,
  shiftEndAt: string | null,
  maxHours = 4,
): string {
  const clockIn = new Date(clockInAt).getTime()
  const cap = clockIn + maxHours * 3600_000
  if (shiftEndAt) {
    const end = new Date(shiftEndAt).getTime()
    // Use the shift end if it's after clock-in and not absurdly long.
    if (end > clockIn) return new Date(Math.min(end, cap)).toISOString()
  }
  return new Date(cap).toISOString()
}
