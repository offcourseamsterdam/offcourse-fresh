import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'

/**
 * GET /api/admin/fareharbor-items
 *
 * Returns the list of FareHarbor items synced into our database, including the
 * per-item settings (booking cutoff, slot capacity, cancellation tiers). Used by
 * the cruise editor (name display + read-only cancellation policy) and the
 * FareHarbor settings page (full editor). These run in the browser, so they must
 * read through this server-side route — not the service-role client directly.
 *
 * Tiny payload — usually < 10 rows — so we return everything in one call.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('fareharbor_items')
      .select(
        'id, fareharbor_pk, name, shortname, item_type, is_active, booking_cutoff_hours, max_slot_capacity, cancellation_tiers'
      )
      .order('name', { ascending: true })

    if (error) return apiError(error.message)
    return apiOk({ items: data ?? [] })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
