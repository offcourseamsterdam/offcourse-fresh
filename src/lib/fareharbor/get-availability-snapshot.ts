import { createAdminClient } from '@/lib/supabase/admin'
import type { CruiseAvailabilitySnapshot } from './sync-availability'

/**
 * Retrieves the precomputed availability snapshot for a single cruise listing.
 * Used by Server Components to embed structured availability into HTML and Schema.org.
 */
export async function getCruiseAvailabilitySnapshot(
  listingId: string
): Promise<CruiseAvailabilitySnapshot | null> {
  const supabase = createAdminClient()
  const { data, error } = await (supabase
    .from('cruise_availability_snapshots') as any)
    .select('*')
    .eq('listing_id', listingId)
    .single()

  if (error || !data) return null
  return data as unknown as CruiseAvailabilitySnapshot
}

/**
 * Retrieves availability snapshots for all cruise listings, keyed by listing_id.
 * Used by the /cruises index page.
 */
export async function getAllCruiseAvailabilitySnapshots(): Promise<Map<string, CruiseAvailabilitySnapshot>> {
  const supabase = createAdminClient()
  const { data, error } = await (supabase
    .from('cruise_availability_snapshots') as any)
    .select('*')

  const map = new Map<string, CruiseAvailabilitySnapshot>()
  if (error || !data) return map

  for (const row of data) {
    map.set(row.listing_id, row as unknown as CruiseAvailabilitySnapshot)
  }
  return map
}
