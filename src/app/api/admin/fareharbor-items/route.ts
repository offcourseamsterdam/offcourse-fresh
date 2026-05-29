import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'

/**
 * GET /api/admin/fareharbor-items
 *
 * Returns the list of FareHarbor items synced into our database. Used by the
 * cruise editor to display the human-readable name alongside the FH item PK.
 *
 * Tiny payload — usually < 10 rows — so we return everything in one call.
 */
export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('fareharbor_items')
      .select('fareharbor_pk, name, shortname')
      .order('name', { ascending: true })

    if (error) return apiError(error.message)
    return apiOk({ items: data ?? [] })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
