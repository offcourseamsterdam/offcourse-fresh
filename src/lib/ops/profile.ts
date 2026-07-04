/**
 * Operational profile — how much the ops engine is allowed to touch a
 * booking. Derived from `category` ('private' | 'shared'), the same field
 * already denormalized on both `bookings` and `cruise_listings` rows — no
 * new table needed until a real per-booking override shows up.
 *
 * Shared cruises are the flexible half of the fleet (PRD "Shared vs Private
 * Cruises"): the Ghost may combine sailings, propose a different time,
 * different boat. Private cruises protect the premium experience — the
 * engine may only touch them when the operational gain is large enough to
 * justify asking, and it must still ask (never move a private booking
 * without a human approving the guest-facing message first).
 */
export interface OperationalProfile {
  kind: 'flexible' | 'protected'
  allowTimeChange: boolean
  allowMerge: boolean
  allowBoatSwap: boolean
}

const FLEXIBLE: OperationalProfile = {
  kind: 'flexible',
  allowTimeChange: true,
  allowMerge: true,
  allowBoatSwap: true,
}

const PROTECTED: OperationalProfile = {
  kind: 'protected',
  allowTimeChange: false,
  allowMerge: false,
  allowBoatSwap: false,
}

/** `category` is 'shared' or 'private' today; anything else defaults to protected (safest). */
export function deriveOperationalProfile(category: string | null | undefined): OperationalProfile {
  return category === 'shared' ? FLEXIBLE : PROTECTED
}
