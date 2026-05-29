import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/require-admin'

/**
 * GET /api/admin/boats
 *
 * Returns all active boats with their FareHarbor customer type PKs.
 * Used by the listing editor Filters tab to auto-fill allowed_customer_type_pks
 * when a boat is selected.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('boats')
      .select('id, name, max_capacity, fareharbor_customer_type_pks')
      .eq('is_active', true)
      .order('display_order')

    if (error) return apiError(error.message)
    return apiOk({ data: data ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
