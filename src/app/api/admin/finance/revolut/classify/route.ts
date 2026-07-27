import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/finance/revolut/classify
 *
 * Confirm the VAT split for one Revolut transaction — how much of its gross
 * amount is a 9% cruise sale vs. a 21% drinks/merch sale. The two amounts
 * don't have to add up to the transaction's original_amount_cents (that's
 * left to whoever's classifying to get right), but a mismatch is worth
 * flagging in the UI, not silently accepted here.
 *
 * Body (JSON): { id, vat9GrossCents, vat21GrossCents }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.id !== 'string' || !body.id) {
      return apiError('id is required', 400)
    }
    if (typeof body.vat9GrossCents !== 'number' || !Number.isFinite(body.vat9GrossCents)) {
      return apiError('vat9GrossCents must be a number', 400)
    }
    if (typeof body.vat21GrossCents !== 'number' || !Number.isFinite(body.vat21GrossCents)) {
      return apiError('vat21GrossCents must be a number', 400)
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('revolut_transactions')
      .update({
        vat9_gross_cents: body.vat9GrossCents,
        vat21_gross_cents: body.vat21GrossCents,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
    if (error) return apiError(error.message)

    return apiOk({ id: body.id })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
