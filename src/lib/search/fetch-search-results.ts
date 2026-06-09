import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { buildTypeMapFromAvailabilities } from '@/lib/fareharbor/config'
import { applyAllFilters, getValidTimeSlots } from '@/lib/fareharbor/filters'
import { applyCutoff, transformToSlot } from '@/lib/fareharbor/availability'
import type { FHMinimalAvailability } from '@/lib/fareharbor/types'
import type { SearchListingRow, SearchResult } from '@/types'

// Internal shape: narrow listing select + the filter fields used server-side
type ListingRow = SearchListingRow & {
  fareharbor_item_pk: number
  allowed_resource_pks: number[] | null
  allowed_customer_type_pks: number[] | null
  availability_filters: unknown
  booking_cutoff_hours: number | null
  max_guests: number | null
}

/**
 * Fetch search results for a given date + guest count.
 *
 * Deduplicates FareHarbor API calls: many listings share one fareharbor_item_pk,
 * so we fetch availability once per unique item and fan the results out per listing.
 * Also fixes select('*') on cruise_listings — only the fields the UI actually needs.
 */
export async function fetchSearchResults(date: string, guests: number): Promise<SearchResult[]> {
  const supabase = createAdminClient()

  const { data: rawListings, error } = await supabase
    .from('cruise_listings')
    .select('id, slug, title, tagline, category, hero_image_url, starting_price, price_display, price_label, departure_location, fareharbor_item_pk, allowed_resource_pks, allowed_customer_type_pks, availability_filters, booking_cutoff_hours, max_guests')
    .eq('is_published', true)
    .order('display_order', { ascending: true })

  if (error || !rawListings?.length) return []

  const listings = rawListings as ListingRow[]

  // 1. Dedup item PKs — many listings may share one FH item
  const itemPks = [...new Set(listings.map(l => l.fareharbor_item_pk))]

  // 2. Fetch FH item metadata in a single query (resource map + cutoff config)
  const { data: fhItems } = await supabase
    .from('fareharbor_items')
    .select('fareharbor_pk, resources, item_type, booking_cutoff_hours, max_slot_capacity')
    .in('fareharbor_pk', itemPks)

  const fhItemMap = new Map(
    (fhItems ?? []).map(item => [item.fareharbor_pk as number, item])
  )

  const resourcePkToBoat = new Map<number, string>()
  for (const item of (fhItems ?? [])) {
    for (const r of (item.resources as Array<{ fareharbor_pk: number; name: string }> ?? [])) {
      const name = r.name.toLowerCase()
      if (name.includes('diana')) resourcePkToBoat.set(r.fareharbor_pk, 'diana')
      else if (name.includes('curaçao') || name.includes('curacao')) resourcePkToBoat.set(r.fareharbor_pk, 'curacao')
    }
  }

  // 3. Fetch availabilities — one FH API call per unique item PK (in parallel)
  const fh = getFareHarborClient()
  const availMap = new Map<number, FHMinimalAvailability[]>()
  await Promise.all(
    itemPks.map(async pk => {
      try {
        availMap.set(pk, await fh.getAvailabilities(pk, date))
      } catch {
        availMap.set(pk, [])
      }
    })
  )

  // 4. Build shared typeMap from all raw availabilities
  const allAvails = [...availMap.values()].flat()
  const typeMap = buildTypeMapFromAvailabilities(allAvails)

  const dateObj = new Date(date + 'T00:00:00')
  const now = new Date()

  // 5. Apply 3-layer filter + cutoff per listing (pure CPU — no network)
  const results: SearchResult[] = await Promise.all(
    listings.map(async listing => {
      const rawAvails = availMap.get(listing.fareharbor_item_pk) ?? []
      const fhItem = fhItemMap.get(listing.fareharbor_item_pk) ?? null

      const filtered = await applyAllFilters(
        rawAvails,
        {
          allowed_resource_pks: listing.allowed_resource_pks,
          allowed_customer_type_pks: listing.allowed_customer_type_pks,
          availability_filters: listing.availability_filters,
        },
        guests,
        dateObj,
        typeMap,
        resourcePkToBoat
      )

      const validSlots = getValidTimeSlots(filtered, guests, typeMap)
      const slots = validSlots.map(a => transformToSlot(a, typeMap))

      const effectiveCutoffItem = {
        booking_cutoff_hours: listing.booking_cutoff_hours ?? fhItem?.booking_cutoff_hours ?? null,
        item_type: (fhItem?.item_type as string | null) ?? null,
        max_slot_capacity: (fhItem?.max_slot_capacity as number | null) ?? listing.max_guests ?? null,
      }
      const availableSlots = applyCutoff(slots, effectiveCutoffItem, now)

      const searchListing: SearchListingRow = {
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        tagline: listing.tagline ?? null,
        category: listing.category,
        hero_image_url: listing.hero_image_url ?? null,
        starting_price: listing.starting_price ?? null,
        price_display: listing.price_display ?? null,
        price_label: listing.price_label ?? null,
        departure_location: listing.departure_location ?? null,
      }

      return { listing: searchListing, availableSlots, date, guests }
    })
  )

  return results
}
