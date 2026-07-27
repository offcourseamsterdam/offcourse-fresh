import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/finance/fareharbor/set-bank-date
 *
 * Confirm the real bank-arrival date for one FareHarbor payout — verified
 * against the bank ledger by exact amount match, NOT FareHarbor's own
 * reported payout date (which turned out unreliable: individual payouts can
 * be off by a few days, and a batch of unrelated payouts can land together
 * as one consolidated bank transfer). This is what BTW-dashboard bucketing
 * uses, and what makes each payout traceable to a real bank transaction for
 * the accountant.
 *
 * Body (JSON): { id, bankPayoutDate: "YYYY-MM-DD" | null, bankNote?: string | null }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.id !== 'string' || !body.id) {
      return apiError('id is required', 400)
    }
    if (body.bankPayoutDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.bankPayoutDate)) {
      return apiError('bankPayoutDate must be "YYYY-MM-DD" or null', 400)
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('fareharbor_payouts')
      .update({
        bank_payout_date: body.bankPayoutDate ?? null,
        bank_note: body.bankNote ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
    if (error) return apiError(error.message)

    return apiOk({ id: body.id })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
