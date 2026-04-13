import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { applyAllFilters } from '@/lib/fareharbor/filters'
import { buildTypeMapFromAvailabilities } from '@/lib/fareharbor/config'
import type { FHMinimalAvailability } from '@/lib/fareharbor/types'

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date')
  if (!date) {
    return apiError('date required (YYYY-MM-DD)', 400)
  }

  const supabase = createAdminClient()

  const { data: rawListings, error: listingsError } = await supabase
    .from('cruise_listings')
    .select('id, title, tagline, slug, category, fareharbor_item_pk, allowed_resource_pks, allowed_customer_type_pks, availability_filters, starting_price, price_display, hero_image_url, departure_location')
    .order('display_order')

  if (listingsError) {
    return apiError(listingsError.message)
  }

  const listings = rawListings ?? []

  if (listings.length === 0) {
    return apiOk([])
  }

  try {
    const fh = getFareHarborClient()

    // Build resource pk → boat name map from fareharbor_items.resources JSONB
    const itemPks = [...new Set(listings.map(l => l.fareharbor_item_pk))]
    const resourcePkToBoat = new Map<number, string>()

    const { data: fhItems } = await supabase
      .from('fareharbor_items')
      .select('fareharbor_pk, resources')
      .in('fareharbor_pk', itemPks)

    for (const item of (fhItems ?? [])) {
      for (const r of (item.resources as Array<{ fareharbor_pk: number; name: string }> ?? [])) {
        const name = r.name.toLowerCase()
        if (name.includes('diana')) resourcePkToBoat.set(r.fareharbor_pk, 'diana')
        else if (name.includes('curaçao') || name.includes('curacao')) resourcePkToBoat.set(r.fareharbor_pk, 'curacao')
      }
    }

    // Fetch availabilities for each unique FH item
    const availMap = new Map<number, FHMinimalAvailability[]>()
    await Promise.all(
      itemPks.map(async pk => {
        try {
          const avails = await fh.getAvailabilities(pk, date)
          availMap.set(pk, avails)
        } catch {
          availMap.set(pk, [])
        }
      })
    )

    // Build customer type map from the live availability data
    const allAvails = [...availMap.values()].flat()
    const typeMap = buildTypeMapFromAvailabilities(allAvails)

    // Apply 3-layer filter per listing
    const parsedDate = new Date(date + 'T12:00:00+02:00')
    const results = await Promise.all(
      listings.map(async listing => {
        const rawAvails = availMap.get(listing.fareharbor_item_pk) ?? []
        const filtered = await applyAllFilters(
          rawAvails,
          {
            allowed_resource_pks: listing.allowed_resource_pks,
            allowed_customer_type_pks: listing.allowed_customer_type_pks,
            availability_filters: listing.availability_filters,
          },
          1,
          parsedDate,
          typeMap,
          resourcePkToBoat
        )
        return {
          id: listing.id,
          title: listing.title,
          tagline: listing.tagline,
          slug: listing.slug,
          fareharbor_item_pk: listing.fareharbor_item_pk,
          category: listing.category,
          starting_price: listing.starting_price,
          price_display: listing.price_display,
          hero_image_url: listing.hero_image_url,
          departure_location: listing.departure_location ?? 'Keizersgracht 62, Amsterdam',
          slots: filtered,
          slot_count: filtered.length,
        }
      })
    )

    return apiOk(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
