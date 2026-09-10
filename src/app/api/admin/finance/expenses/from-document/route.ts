import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { ExpenseActionError, createExpenseFromDocument, loadExpenseDetail } from '@/lib/finance/expenses/actions'
import { parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ documentId: z.string().uuid() })

/**
 * POST /api/admin/finance/expenses/from-document { documentId }
 *
 * Entry point from the Finance Inbox thread view (ContextPane): a document
 * with no bank transaction attached yet (a skipper invoice, a supplier bill)
 * gets its own Expense Record so it can go through link_supplier /
 * draft_payment / forward like any other — see actions.ts's
 * createExpenseFromDocument for why this didn't already exist.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const parsed = await parseBody(request, bodySchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { expenseId } = await createExpenseFromDocument(supabase, parsed.data.documentId)
    return apiOk(await loadExpenseDetail(supabase, expenseId))
  } catch (err) {
    if (err instanceof ExpenseActionError) return apiError(err.message, err.status)
    console.error('[finance/expenses/from-document POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not create expense from document', 500)
  }
}
