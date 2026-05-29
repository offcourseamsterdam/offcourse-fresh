/**
 * Cancellation policy helpers — tiered refund logic.
 *
 * The policy is stored on `fareharbor_items.cancellation_tiers` as a JSONB array
 * of `{ hours_before, refund_percent }`. Virtual cruise listings inherit the
 * policy of their parent FH item.
 *
 * All public functions are pure (no I/O). Time inputs default to `new Date()`
 * but can be overridden for tests and live-updating components.
 */

export interface CancellationTier {
  hours_before: number
  refund_percent: number
}

/**
 * Default policy used when an FH item's `cancellation_tiers` is null or invalid.
 *  - 48h+ before departure → 100% refund
 *  - 24–48h before departure → 50% refund
 *  - <24h before departure → 0% refund
 */
export const DEFAULT_TIERS: CancellationTier[] = [
  { hours_before: 48, refund_percent: 100 },
  { hours_before: 24, refund_percent: 50 },
  { hours_before: 0, refund_percent: 0 },
]

/**
 * Coerces unknown DB JSON into a clean, sorted CancellationTier[].
 * Returns DEFAULT_TIERS if input is null/invalid/empty.
 * Sorting is descending by hours_before so getRefundPercent can early-return.
 */
export function normalizeTiers(raw: unknown): CancellationTier[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_TIERS

  const tiers: CancellationTier[] = []
  for (const t of raw) {
    if (typeof t !== 'object' || t === null) continue
    const obj = t as Record<string, unknown>
    const hours = Number(obj.hours_before)
    const percent = Number(obj.refund_percent)
    if (!Number.isFinite(hours) || hours < 0) continue
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue
    tiers.push({ hours_before: hours, refund_percent: percent })
  }

  if (tiers.length === 0) return DEFAULT_TIERS
  // Sort descending by hours_before so the earliest (most generous) tier is first.
  tiers.sort((a, b) => b.hours_before - a.hours_before)
  return tiers
}

/** Hours from `now` until `departure`. Negative if already past. */
export function hoursUntil(departure: Date, now: Date = new Date()): number {
  return (departure.getTime() - now.getTime()) / (1000 * 60 * 60)
}

/**
 * Refund percent currently applicable for a given departure + policy.
 * Returns 0 if departure is in the past or no tier matches.
 */
export function getRefundPercent(
  departure: Date,
  tiers: CancellationTier[],
  now: Date = new Date()
): number {
  const hours = hoursUntil(departure, now)
  if (hours < 0) return 0
  // Tiers sorted desc; first whose threshold we still meet wins.
  for (const tier of tiers) {
    if (hours >= tier.hours_before) return tier.refund_percent
  }
  return 0
}

/**
 * The next *visible* deadline relevant to the user.
 *
 * Returns the moment at which the current refund tier expires AND the
 * refund percent that will still apply right up until that moment.
 *
 *  - Currently 100% (with a 50% tier below): cutoffAt = 48h-mark, refundPercent = 100
 *  - Currently 50% (with a 0% tier below): cutoffAt = 24h-mark, refundPercent = 50
 *  - Currently in lowest non-zero tier or below: null (nothing useful to show)
 *  - Departure in the past: null
 */
export function getNextCutoff(
  departure: Date,
  tiers: CancellationTier[],
  now: Date = new Date()
): { cutoffAt: Date; refundPercent: number } | null {
  const hours = hoursUntil(departure, now)
  if (hours < 0) return null

  // Walk top→bottom (sorted desc). Find the current tier.
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]
    if (hours >= tier.hours_before) {
      // Current tier is `tier`. Bail if there's no useful next tier below.
      const nextDown = tiers.slice(i + 1).find(t => t.refund_percent < tier.refund_percent)
      if (!nextDown || tier.refund_percent === 0) return null
      // Cutoff = the moment we LEAVE this tier (i.e. when hours drops below tier.hours_before).
      const cutoffAt = new Date(departure.getTime() - tier.hours_before * 60 * 60 * 1000)
      return { cutoffAt, refundPercent: tier.refund_percent }
    }
  }
  return null
}

/**
 * Refundable cents based on policy + amount paid (for future refund-management UI).
 * Rounds to the nearest cent.
 */
export function calculateRefundCents(
  departure: Date,
  tiers: CancellationTier[],
  paidCents: number,
  now: Date = new Date()
): number {
  if (paidCents <= 0) return 0
  const percent = getRefundPercent(departure, tiers, now)
  return Math.round((paidCents * percent) / 100)
}

/**
 * Build human-readable lines for the public cruise-page card.
 * Returns one line per tier, top→bottom, using a "between X–Y hours" style
 * for the middle tiers and "up to / within" for the bookends.
 *
 * Example output for default tiers:
 *   [
 *     { refundPercent: 100, label: 'Full refund', detail: 'up to 48 hours before departure' },
 *     { refundPercent: 50,  label: '50% refund',  detail: '24–48 hours before departure' },
 *     { refundPercent: 0,   label: 'No refund',   detail: 'within 24 hours of departure' },
 *   ]
 */
export function formatTierLines(tiers: CancellationTier[]): Array<{
  refundPercent: number
  label: string
  detail: string
}> {
  return tiers.map((tier, idx) => {
    const next = tiers[idx + 1]
    const label =
      tier.refund_percent === 100
        ? 'Full refund'
        : tier.refund_percent === 0
        ? 'No refund'
        : `${tier.refund_percent}% refund`

    let detail: string
    if (idx === 0) {
      // Top tier — "up to N hours before departure"
      detail = `up to ${tier.hours_before} hours before departure`
    } else if (!next) {
      // Bottom tier — "within N hours of departure"
      detail = `within ${tier.hours_before === 0 ? tiers[idx - 1].hours_before : tier.hours_before} hours of departure`
    } else {
      // Middle tier — "between X–Y hours before departure"
      detail = `${tier.hours_before}–${tiers[idx - 1].hours_before} hours before departure`
    }

    return { refundPercent: tier.refund_percent, label, detail }
  })
}

/**
 * Format a cutoff Date for the checkout messaging line.
 * Output style: "Fri 9 May, 14:30" in Europe/Amsterdam timezone.
 */
export function formatCutoffDateTime(cutoffAt: Date): string {
  const datePart = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Amsterdam',
  }).format(cutoffAt)
  const timePart = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Amsterdam',
  }).format(cutoffAt)
  return `${datePart}, ${timePart}`
}
