/**
 * What a shift costs: a captain's hourly rate × how long the shift runs.
 * Rounds to the nearest cent rather than truncating — a captain paid for
 * partial minutes shouldn't systematically lose a cent every shift.
 */
export function shiftCostCents(hourlyRateCents: number, startAt: string, endAt: string): number {
  const hours = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000
  if (!Number.isFinite(hours) || hours <= 0) return 0
  return Math.round(hourlyRateCents * hours)
}

/** "€37.50" — no decimals dropped, unlike fmtEurosRounded (this is a real cost line item, not a headline price). */
export function fmtCostEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}
