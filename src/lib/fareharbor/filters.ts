import { z } from 'zod'
import type { FHMinimalAvailability, FHCustomerTypeRate } from './types'
import type { CustomerTypeConfig, BoatConfig } from './config'
import { BOATS } from './config'
import { getSunsetTime } from './sunset'

// ── Filter config types ─────────────────────────────────────────────────────

export const AvailabilityFiltersSchema = z.object({
  time_after: z.string().optional(),            // "17:00"
  time_before: z.string().optional(),           // "12:00"
  sunset_offset_minutes: z.number().optional(), // -60 = start 60min before sunset
  sunset_window_minutes: z.number().optional(), // 120 = 2h window around offset
  max_guests_override: z.number().optional(),   // 2 for romantic cruise
  months: z.array(z.number()).optional(),        // [6,7,8] for summer only
  days_of_week: z.array(z.number()).optional(),  // [5,6] for weekends (0=Sun)
}).passthrough()

export type AvailabilityFilters = z.infer<typeof AvailabilityFiltersSchema>

export interface ListingFilterConfig {
  allowed_resource_pks: number[] | null
  allowed_customer_type_pks: number[] | null
  availability_filters: unknown // JSON from Supabase, parsed with zod
}

// ── Reason codes (from PRD edge case table) ─────────────────────────────────

export type ReasonCode =
  | 'TOO_LARGE'
  | 'ALL_FULL'
  | 'NO_AVAILABILITIES'
  | 'PAST_DATE'
  | 'API_ERROR'
  | null

export type BoatStatus = 'available' | 'sold_out' | 'too_many_guests' | 'unavailable'

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getTimeFromISO(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Amsterdam',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Compare two "HH:MM" time strings. Returns negative if a < b, 0 if equal, positive if a > b */
function compareTime(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  return ah * 60 + am - (bh * 60 + bm)
}

/** Convert "HH:MM" to total minutes since midnight */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Deep clone an availability and its rates (so filter mutations don't affect originals) */
function cloneAvailability(a: FHMinimalAvailability): FHMinimalAvailability {
  return {
    ...a,
    customer_type_rates: a.customer_type_rates.map(r => ({ ...r })),
  }
}

// ── Layer 1: Resource filter ────────────────────────────────────────────────

/**
 * Remove customer_type_rates that belong to disallowed resources.
 * If allowed_resource_pks is null/empty, all resources are allowed.
 *
 * NOTE: The minimal availability endpoint doesn't always include resource PKs
 * directly on rates. We use the customer type config to map rates to boats,
 * and then check if the boat's resource is in the allowed list.
 * For this to work, we need the fareharbor_resources PKs from Supabase,
 * mapped to boat names. This is passed in as resourcePkToBoat.
 */
function applyResourceFilter(
  availabilities: FHMinimalAvailability[],
  allowedPks: number[] | null,
  typeMap: Map<number, CustomerTypeConfig>,
  resourcePkToBoat?: Map<number, string>
): FHMinimalAvailability[] {
  if (!allowedPks || allowedPks.length === 0) return availabilities

  // Build set of allowed boat names from resource PKs
  const allowedBoats = new Set<string>()
  if (resourcePkToBoat) {
    for (const pk of allowedPks) {
      const boatName = resourcePkToBoat.get(pk)
      if (boatName) allowedBoats.add(boatName)
    }
  }

  // If we can't resolve resource PKs to boats, skip this filter
  if (allowedBoats.size === 0) return availabilities

  return availabilities
    .map(a => {
      const filtered = cloneAvailability(a)
      filtered.customer_type_rates = filtered.customer_type_rates.filter(rate => {
        const config = typeMap.get(rate.customer_type.pk)
        if (!config) return false
        return allowedBoats.has(config.boat)
      })
      return filtered
    })
    .filter(a => a.customer_type_rates.length > 0)
}

// ── Layer 2: Customer type filter ───────────────────────────────────────────

/**
 * Keep only customer_type_rates whose customer_type.pk is in the allowed list.
 * If allowed_customer_type_pks is null/empty, all types are allowed.
 */
function applyCustomerTypeFilter(
  availabilities: FHMinimalAvailability[],
  allowedPks: number[] | null
): FHMinimalAvailability[] {
  if (!allowedPks || allowedPks.length === 0) return availabilities

  const allowed = new Set(allowedPks)

  return availabilities
    .map(a => {
      const filtered = cloneAvailability(a)
      filtered.customer_type_rates = filtered.customer_type_rates.filter(
        rate => allowed.has(rate.customer_type.pk)
      )
      return filtered
    })
    .filter(a => a.customer_type_rates.length > 0)
}

// ── Layer 3: Time/date rules ────────────────────────────────────────────────

async function applyTimeAndDateRules(
  availabilities: FHMinimalAvailability[],
  filters: AvailabilityFilters,
  date: Date
): Promise<FHMinimalAvailability[]> {
  if (!filters || Object.keys(filters).length === 0) return availabilities

  // Month filter
  if (filters.months && filters.months.length > 0) {
    const month = date.getMonth() + 1 // 1-indexed
    if (!filters.months.includes(month)) return []
  }

  // Day of week filter
  if (filters.days_of_week && filters.days_of_week.length > 0) {
    const day = date.getDay() // 0=Sun, 6=Sat
    if (!filters.days_of_week.includes(day)) return []
  }

  let result = availabilities

  // time_after filter
  if (filters.time_after) {
    result = result.filter(a => {
      const time = getTimeFromISO(a.start_at)
      return compareTime(time, filters.time_after!) >= 0
    })
  }

  // time_before filter
  if (filters.time_before) {
    result = result.filter(a => {
      const time = getTimeFromISO(a.start_at)
      return compareTime(time, filters.time_before!) <= 0
    })
  }

  // Sunset filter
  if (filters.sunset_offset_minutes !== undefined) {
    const sunsetTime = await getSunsetTime(date)
    if (sunsetTime) {
      const sunsetMinutes = timeToMinutes(sunsetTime)
      const windowStart = sunsetMinutes + filters.sunset_offset_minutes
      const windowEnd = windowStart + (filters.sunset_window_minutes ?? 120)

      result = result.filter(a => {
        const slotMinutes = timeToMinutes(getTimeFromISO(a.start_at))
        return slotMinutes >= windowStart && slotMinutes <= windowEnd
      })
    }
    // If sunset data unavailable, don't filter (graceful degradation)
  }

  return result
}

// ── Main: apply all 3 layers ────────────────────────────────────────────────

export async function applyAllFilters(
  availabilities: FHMinimalAvailability[],
  config: ListingFilterConfig,
  guests: number,
  date: Date,
  typeMap: Map<number, CustomerTypeConfig>,
  resourcePkToBoat?: Map<number, string>
): Promise<FHMinimalAvailability[]> {
  // Layer 1: Resource filter
  let filtered = applyResourceFilter(
    availabilities,
    config.allowed_resource_pks,
    typeMap,
    resourcePkToBoat
  )

  // Layer 2: Customer type filter
  filtered = applyCustomerTypeFilter(filtered, config.allowed_customer_type_pks)

  // Layer 3: Time/date rules
  const parsedFilters = AvailabilityFiltersSchema.safeParse(config.availability_filters)
  const filters = parsedFilters.success ? parsedFilters.data : {}
  filtered = await applyTimeAndDateRules(filtered, filters, date)

  // Apply max_guests_override from Layer 3 filters
  const maxGuests = filters.max_guests_override
  const effectiveGuests = maxGuests ? Math.min(guests, maxGuests) : guests

  // Only keep rates that can handle the guest count
  if (effectiveGuests !== guests && maxGuests && guests > maxGuests) {
    // Guest count exceeds the listing's max_guests_override → no results
    return []
  }

  return filtered
}

// ── PRD filter functions (applied AFTER the 3-layer filter) ─────────────────

/**
 * Filter for valid timeslots: a slot is valid if at least one customer_type_rate
 * has capacity >= 1 AND the configured maxGuests >= guestCount.
 * (PRD Section 4.2)
 */
export function getValidTimeSlots(
  availabilities: FHMinimalAvailability[],
  guestCount: number,
  typeMap: Map<number, CustomerTypeConfig>
): FHMinimalAvailability[] {
  return availabilities.filter(a =>
    a.customer_type_rates.some(rate => {
      const config = typeMap.get(rate.customer_type.pk)
      if (!config) return false
      if (config.maxGuests < guestCount) return false
      if ((rate.capacity ?? 0) < 1) return false
      return true
    })
  )
}

/**
 * For a specific availability and boat, return the durations that are
 * currently available for the given guest count.
 * (PRD Section 4.3)
 */
export function getAvailableDurations(
  availability: FHMinimalAvailability,
  boatId: string,
  guestCount: number,
  typeMap: Map<number, CustomerTypeConfig>
): FHCustomerTypeRate[] {
  return availability.customer_type_rates
    .filter(rate => {
      const config = typeMap.get(rate.customer_type.pk)
      if (!config || config.boat !== boatId) return false
      if (config.maxGuests < guestCount) return false
      if ((rate.capacity ?? 0) < 1) return false
      return true
    })
    .sort((a, b) => {
      const ca = typeMap.get(a.customer_type.pk)!
      const cb = typeMap.get(b.customer_type.pk)!
      return ca.duration - cb.duration
    })
}

/**
 * Determine the status of a specific boat at a given timeslot.
 * (PRD Section 4.4)
 */
export function getBoatStatus(
  availability: FHMinimalAvailability,
  boatId: string,
  guestCount: number,
  typeMap: Map<number, CustomerTypeConfig>
): { status: BoatStatus; reason?: string } {
  const boat = BOATS.find(b => b.id === boatId)
  if (!boat) return { status: 'unavailable' }

  // Check if group is too large for this boat
  if (boat.maxGuests < guestCount) {
    return { status: 'too_many_guests', reason: 'TOO_LARGE' }
  }

  // Check if any duration has availability
  const available = getAvailableDurations(availability, boatId, guestCount, typeMap)
  if (available.length === 0) {
    return { status: 'sold_out', reason: 'ALL_FULL' }
  }

  return { status: 'available' }
}

/**
 * For a set of filtered availabilities, determine the overall reason code
 * when no slots are available.
 */
export function getReasonCode(
  availabilities: FHMinimalAvailability[],
  guestCount: number,
  typeMap: Map<number, CustomerTypeConfig>
): ReasonCode {
  if (availabilities.length === 0) return 'NO_AVAILABILITIES'

  // Check if all slots are filtered out due to guest count
  const maxGuestCapacity = Math.max(
    ...Array.from(typeMap.values()).map(c => c.maxGuests)
  )
  if (guestCount > maxGuestCapacity) return 'TOO_LARGE'

  return 'ALL_FULL'
}
