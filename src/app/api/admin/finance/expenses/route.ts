import type { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { listExpenses } from '@/lib/finance/expenses/actions'
import { expenseListQuerySchema } from '@/lib/finance/expenses/schemas'
import { zodMessage } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/expenses?status=open|<status>&q=&before=&limit=
 * Expense Records (one per outgoing payment / received document), newest first, cursor-paged.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = expenseListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return apiError(zodMessage(parsed.error), 400)

  try {
    return apiOk(await listExpenses(createAdminClient(), parsed.data))
  } catch (err) {
    console.error('[finance/expenses GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load expenses', 500)
  }
}
