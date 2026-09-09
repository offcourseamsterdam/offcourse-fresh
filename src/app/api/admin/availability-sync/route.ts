import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncAllCruisesAvailability } from '@/lib/fareharbor/sync-availability'

/**
 * GET /api/admin/availability-sync
 * Returns the current health and status of FareHarbor availability snapshots.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const { data, error } = await (supabase
      .from('cruise_availability_snapshots') as any)
      .select('listing_id, fareharbor_item_pk, category, next_available_slot, snapshot_at, raw_availability_window_days')
      .order('snapshot_at', { ascending: false })

    if (error) return apiError(error.message)

    const snapshots = data ?? []
    const latestSnapshotAt = snapshots.length > 0 ? snapshots[0].snapshot_at : null

    return apiOk({
      count: snapshots.length,
      latestSnapshotAt,
      snapshots,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

/**
 * POST /api/admin/availability-sync
 * Triggers an immediate FareHarbor availability sync & Next.js cache revalidation.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const result = await syncAllCruisesAvailability(14)
    return apiOk(result)
  } catch (err) {
    console.error('[admin/availability-sync] Error:', err)
    return apiError(err instanceof Error ? err.message : 'Sync failed')
  }
}
