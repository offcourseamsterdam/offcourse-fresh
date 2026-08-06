import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { compactAvailability } from '@/lib/ghost/tools'
import type { OtaDetection } from './detect'

export interface OtaAvailabilityResult {
  checked: boolean
  reason?: string
  dateISO?: string
  guests?: number
  /** Same shape Ghost's own search_availability tool returns — real FareHarbor data, not a guess. */
  availability?: unknown
}

/**
 * Runs the SAME real-availability lookup Ghost's chat tool uses
 * (search_availability), for a "new booking request" OTA notification — so
 * the admin can see at a glance whether the requested date/group size is
 * actually bookable before going to confirm it on the OTA's own platform.
 * Read-only: never proposes or creates anything, just surfaces the facts.
 */
export async function checkOtaAvailability(ota: OtaDetection): Promise<OtaAvailabilityResult> {
  const { dateISO, guests } = ota.parsed
  if (!dateISO || !guests) {
    return { checked: false, reason: "Could not read a clear date and guest count from the email — check it manually." }
  }
  const results = await fetchSearchResults(dateISO, guests)
  return { checked: true, dateISO, guests, availability: compactAvailability(results) }
}
