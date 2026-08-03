import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/finance/fareharbor/payouts — every stored payout, newest
 * (by verified bank payout date) first. Feeds the FareHarbor tab's
 * per-payout list.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('fareharbor_payouts')
      .select('*')
      .order('bank_payout_date', { ascending: false, nullsFirst: false })

    if (error) return apiError(error.message)

    const payouts = (data ?? []).map(p => ({
      id: p.id,
      payoutId: p.payout_id,
      payoutDate: p.payout_date,
      bankPayoutDate: p.bank_payout_date,
      bankNote: p.bank_note,
      grossCents: p.gross_cents,
      processingFeeCents: p.processing_fee_cents,
      netCents: p.net_cents,
      subtotalPaidCents: p.subtotal_paid_cents,
      vat9Cents: p.vat9_cents,
      vat21Cents: p.vat21_cents,
      taxPaidCents: p.tax_paid_cents,
      lineCount: p.line_count,
    }))

    return apiOk({ payouts })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
