import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseFareHarborPayoutCsv } from '@/lib/finance/fareharbor-payout-csv'

const MAX_SIZE_BYTES = 5 * 1024 * 1024 // detailed exports can run to hundreds of rows

/**
 * POST /api/admin/finance/fareharbor/upload
 *
 * Upload the "Sales-Payout Reconciliation" advanced report CSV from
 * fareharbor.com/offcourse/dashboard/reports/advanced/payments-and-refunds/
 * — Detailed report, grouped by Payout ID, with "Payout Date" added as a
 * column (the Summary report alone has no date to bucket by). Safe to
 * re-upload anytime: every payout upserts by FareHarbor's own payout_id.
 *
 * Historical only — FareHarbor stopped processing payments directly when
 * the site's native Stripe checkout went live in early May 2026, so this
 * covers a fixed, closed period and won't grow going forward.
 *
 * `bank_payout_date`/`bank_note` are deliberately left OUT of the upsert
 * payload (not even as null) — they're set separately via
 * POST .../fareharbor/set-bank-date once verified against the real bank
 * ledger, and a re-upload of this CSV must never wipe that out.
 *
 * Body: FormData { file }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return apiError('file is required', 400)
    if (!file.name.toLowerCase().endsWith('.csv')) return apiError('Expected a .csv file', 400)
    if (file.size > MAX_SIZE_BYTES) return apiError('File too large', 400)

    const csvText = await file.text()
    const rows = parseFareHarborPayoutCsv(csvText)
    if (rows.length === 0) return apiError('No payout rows found — is this the FareHarbor Sales-Payout Reconciliation export, grouped by Payout ID with Payout Date added?', 400)

    const supabase = createAdminClient()

    const { data: upserted, error } = await supabase
      .from('fareharbor_payouts')
      .upsert(
        rows.map(r => ({
          payout_id: r.payoutId,
          payout_date: r.payoutDate,
          gross_cents: r.grossCents,
          processing_fee_cents: r.processingFeeCents,
          net_cents: r.netCents,
          subtotal_paid_cents: r.subtotalPaidCents,
          vat9_cents: r.vat9Cents,
          vat21_cents: r.vat21Cents,
          tax_paid_cents: r.taxPaidCents,
          line_count: r.lineCount,
        })),
        { onConflict: 'payout_id' }
      )
      .select('id')
    if (error) return apiError(error.message)

    return apiOk({
      rowCount: rows.length,
      storedCount: upserted?.length ?? 0,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
