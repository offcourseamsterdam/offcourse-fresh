import type { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { ExpenseActionError, loadExpenseDetail } from '@/lib/finance/expenses/actions'

export const dynamic = 'force-dynamic'

/** GET /api/admin/finance/expenses/[id] — the record, its documents, and what the status machine derives. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  const { id } = await params
  try {
    return apiOk(await loadExpenseDetail(createAdminClient(), id))
  } catch (err) {
    if (err instanceof ExpenseActionError) return apiError(err.message, err.status)
    console.error('[finance/expenses/[id] GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load expense', 500)
  }
}
