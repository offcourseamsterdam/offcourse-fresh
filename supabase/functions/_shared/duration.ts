/**
 * How long a cruise actually runs.
 *
 * FareHarbor answers this differently per product, which is the whole reason
 * this helper exists:
 *
 *  - SHARED cruises have a fixed departure, so the availability itself carries
 *    a real `end_at` (17:00 → 18:30). Trust it.
 *  - PRIVATE cruises are sold by duration, so the availability is open-ended
 *    and FareHarbor sends `end_at` EQUAL to `start_at`. The real length lives
 *    in the customer type instead — "Diana - 2 Hours", "Curaçao - 1.5 Hours".
 *
 * Read the availability first and fall back to the customer type only when the
 * availability gives nothing usable, so a genuine end time always wins.
 *
 * Shared between the Next.js app (src/lib/scheduling/generate-shifts.ts) and
 * the Deno webhook (fareharbor-webhook), which both have to turn a FareHarbor
 * payload into a real time window — one copy so they can't drift.
 */

/** "Diana - 1.5 Hours" → 90. Null when the name carries no duration. */
export function parseDurationMinutes(customerTypeName: string | null | undefined): number | null {
  if (!customerTypeName) return null
  const m = customerTypeName.match(/([\d]+(?:[.,]\d+)?)\s*hour/i)
  if (!m) return null
  const hours = parseFloat(m[1].replace(',', '.'))
  return Number.isFinite(hours) ? Math.round(hours * 60) : null
}

/**
 * The end of a departure, given whatever FareHarbor supplied. Returns null when
 * neither the availability nor the customer type says anything usable — the
 * caller decides what a duration-less booking should do.
 */
export function resolveEndTime(
  startIso: string | null,
  endIso: string | null,
  customerTypeName: string | null | undefined,
  fallbackMinutes: number | null = null,
): string | null {
  if (!startIso) return null
  const startMs = new Date(startIso).getTime()
  if (Number.isNaN(startMs)) return null

  // A real end time from the availability (shared cruises) always wins.
  if (endIso) {
    const endMs = new Date(endIso).getTime()
    if (!Number.isNaN(endMs) && endMs > startMs) return new Date(endMs).toISOString()
  }

  const minutes = parseDurationMinutes(customerTypeName) ?? fallbackMinutes
  if (!minutes) return null
  return new Date(startMs + minutes * 60_000).toISOString()
}
