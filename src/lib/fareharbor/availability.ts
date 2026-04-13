import { getFareHarborClient } from './client'
import { buildTypeMapFromAvailabilities } from './config'
import {
  applyAllFilters,
  getValidTimeSlots,
  getTimeFromISO,
  getReasonCode,
  type ListingFilterConfig,
  type ReasonCode,
} from './filters'
import { createServiceClient } from '@/lib/supabase/server'
import type { FHMinimalAvailability } from './types'
import type { AvailabilitySlot, AvailabilityCustomerType } from '@/types'
import type { CustomerTypeConfig } from './config'

export interface FilteredAvailabilityResult {
  slots: AvailabilitySlot[]
  reasonCode: ReasonCode
}

export async function getFilteredAvailability(
  listingId: string,
  date: string,
  guests: number
): Promise<FilteredAvailabilityResult> {
  const supabase = await createServiceClient()

  // fareharbor_item_pk is stored directly on the listing — no join needed
  const { data: listing, error: listingError } = await supabase
    .from('cruise_listings')
    .select('id, fareharbor_item_pk, allowed_resource_pks, allowed_customer_type_pks, availability_filters')
    .eq('id', listingId)
    .single()

  if (listingError || !listing) {
    return { slots: [], reasonCode: 'NO_AVAILABILITIES' }
  }

  // Load resource name→boat mapping from the FH item's JSONB resources column
  const { data: fhItem } = await supabase
    .from('fareharbor_items')
    .select('resources')
    .eq('fareharbor_pk', listing.fareharbor_item_pk)
    .single()

  const resourcePkToBoat = new Map<number, string>()
  for (const r of (fhItem?.resources as Array<{ fareharbor_pk: number; name: string }> ?? [])) {
    const name = r.name.toLowerCase()
    if (name.includes('diana')) resourcePkToBoat.set(r.fareharbor_pk, 'diana')
    else if (name.includes('curaçao') || name.includes('curacao')) resourcePkToBoat.set(r.fareharbor_pk, 'curacao')
  }

  const client = getFareHarborClient()
  let rawAvailabilities: FHMinimalAvailability[]
  try {
    rawAvailabilities = await client.getAvailabilities(listing.fareharbor_item_pk, date)
  } catch {
    return { slots: [], reasonCode: 'API_ERROR' }
  }

  if (rawAvailabilities.length === 0) {
    return { slots: [], reasonCode: 'NO_AVAILABILITIES' }
  }

  // Build customer type map from the live availability data
  const typeMap = buildTypeMapFromAvailabilities(rawAvailabilities)

  const filterConfig: ListingFilterConfig = {
    allowed_resource_pks: listing.allowed_resource_pks,
    allowed_customer_type_pks: listing.allowed_customer_type_pks,
    availability_filters: listing.availability_filters,
  }

  const dateObj = new Date(date + 'T00:00:00')
  const filtered = await applyAllFilters(
    rawAvailabilities,
    filterConfig,
    guests,
    dateObj,
    typeMap,
    resourcePkToBoat
  )

  const validSlots = getValidTimeSlots(filtered, guests, typeMap)

  if (validSlots.length === 0) {
    const reason = getReasonCode(filtered, guests, typeMap)
    return { slots: [], reasonCode: reason }
  }

  const slots = validSlots.map(a => transformToSlot(a, typeMap))

  return { slots, reasonCode: null }
}

export async function getRawAvailabilities(
  fhItemPk: number,
  date: string
): Promise<FHMinimalAvailability[]> {
  const client = getFareHarborClient()
  try {
    return await client.getAvailabilities(fhItemPk, date)
  } catch {
    return []
  }
}

export async function applyListingFilters(
  rawAvailabilities: FHMinimalAvailability[],
  filterConfig: ListingFilterConfig,
  guests: number,
  date: string,
  typeMap: Map<number, CustomerTypeConfig>,
  resourcePkToBoat: Map<number, string>
): Promise<FilteredAvailabilityResult> {
  if (rawAvailabilities.length === 0) {
    return { slots: [], reasonCode: 'NO_AVAILABILITIES' }
  }

  const dateObj = new Date(date + 'T00:00:00')
  const filtered = await applyAllFilters(
    rawAvailabilities,
    filterConfig,
    guests,
    dateObj,
    typeMap,
    resourcePkToBoat
  )

  const validSlots = getValidTimeSlots(filtered, guests, typeMap)

  if (validSlots.length === 0) {
    const reason = getReasonCode(filtered, guests, typeMap)
    return { slots: [], reasonCode: reason }
  }

  const slots = validSlots.map(a => transformToSlot(a, typeMap))
  return { slots, reasonCode: null }
}

export function transformToSlot(
  availability: FHMinimalAvailability,
  typeMap: Map<number, CustomerTypeConfig>
): AvailabilitySlot {
  const startTime = getTimeFromISO(availability.start_at)

  // Calculate actual duration from start/end timestamps (reliable for all cruise types)
  const slotDurationMinutes = Math.round(
    (new Date(availability.end_at).getTime() - new Date(availability.start_at).getTime()) / 60000
  )

  const customerTypes: AvailabilityCustomerType[] = availability.customer_type_rates
    .map(rate => {
      const config = typeMap.get(rate.customer_type.pk)
      // Use config duration if parsed from name (e.g. "Diana 1.5h"), otherwise
      // fall back to actual slot duration from start_at/end_at timestamps.
      // This fixes shared cruise types like "Adult"/"Child" that have no duration in the name.
      const durationMinutes = config?.duration ?? slotDurationMinutes || 120
      return {
        pk: rate.pk,
        totalCapacity: rate.capacity,
        customerTypePk: rate.customer_type.pk,
        boatId: config?.boat ?? 'curacao',
        minimumParty: rate.minimum_party_size ?? 1,
        maximumParty: rate.maximum_party_size ?? (config?.maxGuests ?? 12),
        priceCents: rate.customer_prototype?.total ?? 0,
        durationMinutes,
      }
    })

  return {
    pk: availability.pk,
    startTime,
    startAt: availability.start_at,
    endAt: availability.end_at,
    headline: availability.headline ?? startTime,
    customerTypes,
    capacity: availability.customer_type_rates.length > 0
      ? Math.max(...availability.customer_type_rates.map(r => r.capacity ?? 0))
      : 0,
  }
}
