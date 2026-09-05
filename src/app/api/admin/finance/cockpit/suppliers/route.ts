import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/suppliers — active suppliers, for the
 * manual-upload picker (and future supplier management UI).
 *
 * Returns `has_iban`, never the IBAN itself: the picker only needs to know
 * whether "Goedkeuren & betalen" will be possible, and bank details have no
 * business in a browser payload that's fetched every time the modal opens.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('finance_suppliers')
      .select('id, name, staff_id, iban')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (error) return apiError(error.message, 500)
    return apiOk((data ?? []).map(s => ({ id: s.id, name: s.name, staff_id: s.staff_id, has_iban: !!s.iban })))
  } catch (err) {
    console.error('[finance/cockpit/suppliers GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load suppliers', 500)
  }
}
