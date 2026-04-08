import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * GET /api/admin/boats
 *
 * Returns all active boats with their FareHarbor customer type PKs.
 * Used by the listing editor Filters tab to auto-fill allowed_customer_type_pks
 * when a boat is selected.
 */
export async function GET() {
  try {
    const supabase = await createServiceClient()
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
