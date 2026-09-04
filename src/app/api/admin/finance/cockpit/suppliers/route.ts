import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/cockpit/suppliers — active suppliers, for the manual-upload picker (and future supplier management UI). */
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
    return apiOk(data ?? [])
  } catch (err) {
    console.error('[finance/cockpit/suppliers GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load suppliers', 500)
  }
}
