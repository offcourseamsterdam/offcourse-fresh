/**
 * On-the-water upsell commission (Beer, 2026-08-24: "if a captain upsells an
 * extra hour or 30 minutes, lets say its the last tour... they can have 50%
 * commission on that"). One constant, one function — so a future rate change
 * only ever needs to happen here, and commission math can never drift from
 * how it's actually logged (src/app/api/admin/scheduling/extra-hours-bonus/route.ts).
 */
export const EXTRA_HOURS_COMMISSION_RATE = 0.5

/** Commission in cents for what was charged, rounded to the nearest cent. */
export function commissionCentsFor(amountChargedCents: number): number {
  return Math.round(amountChargedCents * EXTRA_HOURS_COMMISSION_RATE)
}
