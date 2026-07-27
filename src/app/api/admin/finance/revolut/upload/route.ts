import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseRevolutStatementCsv } from '@/lib/finance/revolut-statement'

const MAX_SIZE_BYTES = 2 * 1024 * 1024 // plain text CSV, generous headroom

/**
 * POST /api/admin/finance/revolut/upload
 *
 * Upload the "Merchant reconciliation statement" CSV export from the
 * Revolut Business dashboard. Only Settlement rows (customer payments) get
 * stored — Transfer rows (payouts to the bank) already show up as their own
 * lines in the bank ledger and carry no VAT info of their own.
 *
 * Safe to re-upload anytime: every row upserts by Revolut's own
 * transaction_id, and vat9GrossCents/vat21GrossCents are deliberately left
 * OUT of the upsert payload entirely (not even as null) so a re-upload never
 * overwrites a classification a human already confirmed via /classify.
 * payout_date IS overwritten on every upload, though — it's derived fresh
 * from the CSV's own Transfer history each time (see revolut-statement.ts),
 * so a re-upload with more recent data can correctly flip a transaction
 * from "not yet paid out" to confirmed once its Transfer shows up.
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
    const rows = parseRevolutStatementCsv(csvText)
    if (rows.length === 0) return apiError('No Settlement rows found — is this the Revolut merchant reconciliation statement?', 400)

    const supabase = createAdminClient()

    const { data: upserted, error } = await supabase
      .from('revolut_transactions')
      .upsert(
        rows.map(r => ({
          transaction_id: r.transactionId,
          occurred_at: r.occurredAt,
          payout_date: r.payoutDate,
          description: r.description,
          customer_name: r.customerName,
          original_amount_cents: r.originalAmountCents,
          settlement_amount_cents: r.settlementAmountCents,
          processing_fee_cents: r.processingFeeCents,
        })),
        { onConflict: 'transaction_id' }
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
