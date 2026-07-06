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
