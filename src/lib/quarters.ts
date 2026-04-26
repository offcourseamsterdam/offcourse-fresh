/**
 * Quarter math helpers. All operate on UTC dates.
 *
 * Format: '2026-Q1', '2026-Q2', etc.
 *   Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec.
 */

export function quarterFromDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() // 0-indexed
  const q = Math.floor(month / 3) + 1
  return `${year}-Q${q}`
}

export function currentQuarter(d: Date = new Date()): string {
  return quarterFromDate(d)
}

export function quarterRange(quarter: string): { start: Date; endExclusive: Date } {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter)
  if (!match) throw new Error(`Invalid quarter format: ${quarter}`)
  const year = Number(match[1])
  const q = Number(match[2])
  const startMonth = (q - 1) * 3
  const start = new Date(Date.UTC(year, startMonth, 1))
  const endExclusive = new Date(Date.UTC(year, startMonth + 3, 1))
  return { start, endExclusive }
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function quarterLabel(quarter: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter)
  if (!match) throw new Error(`Invalid quarter format: ${quarter}`)
  const year = match[1]
  const q = Number(match[2])
  const startMonth = (q - 1) * 3
  return `${MONTH_LABELS[startMonth]} – ${MONTH_LABELS[startMonth + 2]} ${year}`
}

/** Returns the previous N quarters in chronological order (oldest first). Excludes the `from` quarter. */
export function previousQuarters(count: number, from: Date = new Date()): string[] {
  const out: string[] = []
  const fromQuarter = currentQuarter(from)
  const match = /^(\d{4})-Q([1-4])$/.exec(fromQuarter)!
  let year = Number(match[1])
  let q = Number(match[2])
  for (let i = 0; i < count; i++) {
    q -= 1
    if (q < 1) {
      q = 4
      year -= 1
    }
    out.unshift(`${year}-Q${q}`)
  }
  return out
}
