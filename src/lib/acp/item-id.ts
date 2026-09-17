/**
 * ACP's `items[]` are opaque `{id, quantity}` pairs — the spec leaves the id
 * format entirely up to the merchant. This site encodes everything needed
 * to identify one bookable rate into the id itself: which listing, which
 * FareHarbor availability, and which customer-type RATE (adult/child for
 * shared cruises, boat+duration for private charters). `quantity` is then
 * how many of that rate the buyer wants.
 *
 * Uses the availability's own `pk` rather than a display time string.
 * FareHarbor's `startTime` is a human-formatted string like "11am" or
 * "2:30pm" (see formatDisplayTime in fareharbor/availability.ts) — not a
 * parseable "HH:MM" — so matching on it would silently never match real
 * data. `availPk` is unambiguous and is what calculateQuote()/FareHarbor
 * bookings need anyway.
 *
 * Deliberately named `customerTypeRatePk`, not `customerTypePk` — FareHarbor
 * has two different pks per rate (a customer_type pk and a
 * customer_type_rate pk) and calculateQuote()/FareHarbor bookings need the
 * RATE pk specifically. See project memory "two-pk-rate-vs-type": mixing
 * the two up previously produced a DOA shared-checkout bug.
 */
export interface DecodedItemId {
  slug: string
  date: string
  availPk: number
  customerTypeRatePk: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function encodeItemId(item: DecodedItemId): string {
  return [item.slug, item.date, item.availPk, item.customerTypeRatePk].join('|')
}

/** Returns null for anything that isn't a well-formed item id — callers turn that into a checkout message, not a crash. */
export function decodeItemId(id: string): DecodedItemId | null {
  const parts = id.split('|')
  if (parts.length !== 4) return null

  const [slug, date, availPkStr, customerTypeRatePkStr] = parts
  if (!slug || !DATE_RE.test(date)) return null

  const availPk = Number(availPkStr)
  const customerTypeRatePk = Number(customerTypeRatePkStr)
  if (!Number.isInteger(availPk) || availPk <= 0) return null
  if (!Number.isInteger(customerTypeRatePk) || customerTypeRatePk <= 0) return null

  return { slug, date, availPk, customerTypeRatePk }
}
