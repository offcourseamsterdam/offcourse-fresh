import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { listOrphanDocuments } from '@/lib/finance/expenses/actions'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/expenses/documents/orphans — documents not yet linked to any payment (the "link by hand" pool). */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    return apiOk({ documents: await listOrphanDocuments(createAdminClient()) })
  } catch (err) {
    console.error('[finance/expenses/documents/orphans GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load documents', 500)
  }
}
