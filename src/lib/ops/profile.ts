/**
 * Operational profile — how much the ops engine is allowed to touch a
 * booking. Derived from `category` ('private' | 'shared'), the same field
 * already denormalized on both `bookings` and `cruise_listings` rows — no
 * new table needed until a real per-booking override shows up.
 *
 * Shared cruises are the flexible half of the fleet (PRD "Shared vs Private
 * Cruises"): the Ghost may combine sailings, propose a different time,
 * different boat.
 *
 * Private cruises stay exclusive — a private booking is NEVER merged onto a
 * shared departure, that would break the thing the guest paid for — but they
 * are NOT off-limits for a time or boat change (Beer 2026-07-04: private
 * cruises can definitely be moved, same threshold as shared). The engine
 * still only ever ASKS: no booking moves without a human approving the
 * guest-facing message first, on either kind.
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
  allowTimeChange: true,
  allowMerge: false,
  allowBoatSwap: true,
}

/** `category` is 'shared' or 'private' today; anything else defaults to protected (safest — no merge). */
export function deriveOperationalProfile(category: string | null | undefined): OperationalProfile {
  return category === 'shared' ? FLEXIBLE : PROTECTED
}
