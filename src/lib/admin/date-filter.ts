export type DateCreatedFilter = 'all' | 'today' | 'week' | 'month' | 'quarter' | 'year'

/**
 * Returns the start-of-period Date for a given date-created filter preset,
 * or null when the filter is 'all' (no threshold applied).
 *
 * All thresholds are floored to midnight Amsterdam time so that a booking
 * created at 09:00 today passes the "today" filter.
 *
 * @param filter - the active filter preset
 * @param now    - reference point (defaults to `new Date()`); injectable for testing
 */
export function dateCreatedThreshold(filter: DateCreatedFilter, now = new Date()): Date | null {
  if (filter === 'all') return null

  // Work in Amsterdam local time by computing the offset
  const ams = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }))

  const year = ams.getFullYear()
  const month = ams.getMonth()     // 0-based
  const day = ams.getDate()
  const dow = ams.getDay()         // 0 = Sunday

  // Build a "midnight Amsterdam" date, then convert to UTC for comparison.
  // We create the date string in Amsterdam local time and let the browser parse it.
  function amsStartOf(y: number, m: number, d: number): Date {
    // Construct as a local-time string to avoid UTC shift
    const localStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00`
    // Parse as Amsterdam time using the Intl trick
    const ref = new Date(localStr)
    const offset = ref.getTime() - new Date(ref.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })).getTime()
    return new Date(ref.getTime() + offset)
  }

  if (filter === 'today') return amsStartOf(year, month, day)

  if (filter === 'week') {
    // ISO week: Monday = day 1. If today is Sunday (0), step back 6 days.
    const daysBack = dow === 0 ? 6 : dow - 1
    return amsStartOf(year, month, day - daysBack)
  }

  if (filter === 'month') return amsStartOf(year, month, 1)

  if (filter === 'quarter') {
    const quarterStart = Math.floor(month / 3) * 3
    return amsStartOf(year, quarterStart, 1)
  }

  if (filter === 'year') return amsStartOf(year, 0, 1)

  return null
}
