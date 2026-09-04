import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 200

/**
 * GET /api/admin/finance/cockpit/transactions
 *   ?state=pending|completed|…  ?direction=in|out  ?q=text  ?limit=50  ?before=<created_at cursor>
 * Newest first. Classification columns are included (null until Phase 3).
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const p = new URL(req.url).searchParams
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.get('limit') ?? 50) || 50))
    const supabase = createAdminClient()
    let q = supabase
      .from('bank_transactions')
      .select('id, revolut_id, type, state, created_at, completed_at, amount_cents, fee_cents, currency, balance_after_cents, reference, description, counterparty, merchant, category, subcategory, boat_id, goal_id, obligation_id, loan_payment_id, invoice_id, classified_by, confidence, classification_reason, needs_review, reviewed_at')
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    const state = p.get('state')
    if (state) q = q.eq('state', state)
    const direction = p.get('direction')
    if (direction === 'in') q = q.gt('amount_cents', 0)
    if (direction === 'out') q = q.lt('amount_cents', 0)
    if (p.get('needs_review') === 'true') q = q.eq('needs_review', true)
    const before = p.get('before')
    if (before) q = q.lt('created_at', before)
    const text = p.get('q')?.trim()
    if (text) q = q.or(`description.ilike.%${text.replace(/[%,]/g, '')}%,reference.ilike.%${text.replace(/[%,]/g, '')}%`)

    const { data, error } = await q
    if (error) return apiError(error.message, 500)
    const rows = data ?? []
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return apiOk({ transactions: page, nextBefore: hasMore ? page[page.length - 1].created_at : null })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}
