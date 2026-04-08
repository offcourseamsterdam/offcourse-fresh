import { getFareHarborClient } from './client'
import { createServiceClient } from '@/lib/supabase/server'
import type { FHMinimalAvailability } from './types'

export interface SyncResult {
  ok: boolean
  synced_at: string
  items_count: number
  resources_count: number
  customer_types_count: number
  error?: string
}

function parseBoatName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('diana')) return 'diana'
  if (lower.includes('curaçao') || lower.includes('curacao')) return 'curacao'
  return 'unknown'
}

function parseDurationMinutes(name: string): number {
  const match = name.match(/(\d+[.,]?\d*)\s*h/i)
  if (match) return Math.round(parseFloat(match[1].replace(',', '.')) * 60)
  const numMatch = name.match(/(\d+[.,]\d+)/)
  if (numMatch) return Math.round(parseFloat(numMatch[1].replace(',', '.')) * 60)
  return 120
}

function getMaxGuests(boat: string): number {
  return boat === 'diana' ? 8 : 12
}

// Downloads all FareHarbor items and upserts them into the Supabase cache tables.
// Returns a summary of what was synced.
export async function syncFareHarborItems(): Promise<SyncResult> {
  const now = new Date().toISOString()

  try {
    const client = getFareHarborClient()
    const supabase = await createServiceClient()
    const items = await client.getItems()

    let resourcesCount = 0
    let ctCount = 0

    // Build a date range for the next 7 days to find availabilities
    // (resources and customer_type_rates live on availabilities, not items)
    const today = new Date()
    const startDate = today.toISOString().split('T')[0]
    const endDate = new Date(today.getTime() + 6 * 86400000).toISOString().split('T')[0]

    for (const item of items) {
      const shortname = ((item as unknown) as Record<string, unknown>).shortname as string ?? 'offcourse'
      const itemType: 'private' | 'shared' = (item.name as string).toLowerCase().includes('shared') ? 'shared' : 'private'

      // Check if item already exists to avoid overwriting resources/customer_types
      const { data: existing } = await supabase
        .from('fareharbor_items')
        .select('id')
        .eq('fareharbor_pk', item.pk)
        .single()

      let itemId: string | undefined
      if (existing) {
        await supabase
          .from('fareharbor_items')
          .update({ name: item.name, shortname, item_type: itemType, is_active: true, last_synced_at: now })
          .eq('fareharbor_pk', item.pk)
        itemId = existing.id
      } else {
        const { data: inserted } = await supabase
          .from('fareharbor_items')
          .insert({ fareharbor_pk: item.pk, name: item.name, shortname, item_type: itemType, is_active: true, last_synced_at: now, resources: [], customer_types: [] })
          .select('id')
          .single()
        itemId = inserted?.id
      }

      if (!itemId) continue

      // Fetch one availability to extract resources + customer_type_rates
      // (FH items endpoint doesn't include these — they're per-availability)
      let availabilities: FHMinimalAvailability[] = []
      try {
        availabilities = await client.getAvailabilitiesDateRange(item.pk, startDate, endDate)
      } catch { /* no availabilities — skip resources/types */ }

      if (availabilities.length > 0) {
        // Get the full availability detail for the first slot (has resource info)
        const detail = await client.getAvailabilityDetail(availabilities[0].pk)

        // Build resources array from availability detail
        const rawResources = ((detail as unknown) as Record<string, unknown>).resources as Array<Record<string, unknown>> | undefined
        const resourcesJson = (rawResources ?? []).map(r => ({
          fareharbor_pk: r.pk as number,
          name: r.name as string,
          capacity: (r.capacity as number) ?? 1,
        }))

        // Build customer_types array from minimal availability
        const ctRates = availabilities[0].customer_type_rates ?? []
        const customerTypesJson = ctRates.map(rate => {
          const name = rate.customer_type?.singular || rate.customer_type?.plural || ''
          const boat = parseBoatName(name)
          return {
            fareharbor_pk: rate.pk,
            name,
            boat_name: boat,
            duration_minutes: parseDurationMinutes(name),
            max_guests: getMaxGuests(boat),
            price_cents: rate.customer_prototype?.total ?? null,
          }
        })

        // Write both as JSONB on the item row (single update, no extra tables)
        await supabase
          .from('fareharbor_items')
          .update({ resources: resourcesJson, customer_types: customerTypesJson, last_synced_at: now })
          .eq('id', itemId)

        resourcesCount += resourcesJson.length
        ctCount += customerTypesJson.length
      }
    }

    return {
      ok: true,
      synced_at: now,
      items_count: items.length,
      resources_count: resourcesCount,
      customer_types_count: ctCount,
    }
  } catch (err) {
    return {
      ok: false,
      synced_at: now,
      items_count: 0,
      resources_count: 0,
      customer_types_count: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// Load all synced items with their resources and customer types from Supabase.
// resources and customer_types are now JSONB columns on the item row — single query.
export async function loadSyncedItems() {
  const supabase = await createServiceClient()
  const { data, error } = await supabase.from('fareharbor_items').select('*').order('name')
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const, data: data ?? [], synced_at: data?.[0]?.last_synced_at ?? null }
}
