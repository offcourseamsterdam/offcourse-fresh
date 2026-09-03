/**
 * Cutoff date for the catering auto-send window (see cron/catering-auto-send).
 *
 * Returns the Amsterdam-local YYYY-MM-DD date `daysAhead` days from `now`. A
 * booking is "within the window" when its booking_date is on or before this
 * cutoff — i.e. departure is `daysAhead` days away or less.
 */
export function cateringAutoSendCutoffDate(daysAhead: number, now: Date = new Date()): string {
  const target = new Date(now)
  target.setDate(target.getDate() + daysAhead)
  return target.toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })
}

/**
 * True when `bookingDate` (YYYY-MM-DD) is `daysAhead` days from now or sooner —
 * i.e. this booking is already inside the auto-send window at the moment it's
 * created, so its catering email should go out instantly instead of waiting
 * for the daily cron to pick it up once it crosses the threshold.
 */
export function isWithinCateringAutoSendWindow(
  bookingDate: string | null | undefined,
  daysAhead = 7,
  now: Date = new Date(),
): boolean {
  if (!bookingDate) return false
  return bookingDate <= cateringAutoSendCutoffDate(daysAhead, now)
}

/**
 * Days remaining until the auto-send cron will pick this booking up (see
 * cron/catering-auto-send). 0 or negative means it's already inside the
 * window — sends today's cron run (or should already have gone out).
 * Dates are plain YYYY-MM-DD calendar strings, diffed via UTC epoch so DST
 * never skews the day count.
 */
export function daysUntilCateringAutoSend(
  bookingDate: string | null | undefined,
  daysAhead = 7,
  now: Date = new Date(),
): number | null {
  if (!bookingDate) return null
  const today = cateringAutoSendCutoffDate(0, now)
  const [by, bm, bd] = bookingDate.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const daysUntilDeparture = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ty, tm - 1, td)) / (24 * 60 * 60 * 1000))
  return daysUntilDeparture - daysAhead
}

