/**
 * The one place that defines "bookable as a private cruise" for an OTA
 * availability result — shared by the server (lib/ota/handle-message.ts,
 * which stamps conversations.ota_available from this) and the client
 * (admin ContextPane's OtaAvailabilityCard, which renders from the raw
 * `availability` payload already stored on the proposal). Deliberately
 * dependency-free so it's safe to import from a 'use client' component.
 *
 * Withlocals and GetMyBoat only ever list Off Course's PRIVATE cruise —
 * never the shared ones. The underlying FareHarbor search returns every
 * matching listing for the date/guest count though (shared included), so
 * this narrows to what the guest actually requested before deciding
 * bookable/not — otherwise a shared-only slot could read as "available" for
 * a request that was never bookable as a private cruise.
 */

export interface AvailabilityOption {
  name: string
  price_eur: number
  duration_min: number
}

export interface AvailabilityListing {
  category?: string
  listing?: string
  options?: AvailabilityOption[]
}

export function pickCheapestPrivateOption(
  listings: AvailabilityListing[] | undefined,
): { bookable: boolean; cheapest?: AvailabilityOption } {
  const privateListings = (listings ?? []).filter(l => l.category === 'private')
  const cheapest = privateListings.flatMap(l => l.options ?? []).sort((a, b) => a.price_eur - b.price_eur)[0]
  return cheapest ? { bookable: true, cheapest } : { bookable: false }
}
