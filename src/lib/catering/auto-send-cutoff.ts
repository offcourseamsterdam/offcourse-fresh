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
