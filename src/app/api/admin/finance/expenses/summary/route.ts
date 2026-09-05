import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadExpenseSummary } from '@/lib/finance/expenses/summary'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/expenses/summary — status counts + VAT position (reclaimable vs payable) for the current and previous quarter. */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    return apiOk(await loadExpenseSummary(createAdminClient()))
  } catch (err) {
    console.error('[finance/expenses/summary GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load summary', 500)
  }
}
