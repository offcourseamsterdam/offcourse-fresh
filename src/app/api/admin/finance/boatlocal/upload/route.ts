import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBoatLocalPayoutPdf } from '@/lib/finance/boatlocal-payout'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'

const MAX_SIZE_BYTES = 5 * 1024 * 1024 // multi-page invoices, allow a bit more headroom

/**
 * POST /api/admin/finance/boatlocal/upload
 *
 * Upload a BoatLocal "Operator Invoice" PDF (the monthly payout email
 * attachment) and store the VAT-broken-out totals + every booking line.
 * Safe to re-upload: keyed by invoice number, lines keyed by
 * (batch, date, guest, total) so a repeat upload is a no-op.
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
    if (!file.name.toLowerCase().endsWith('.pdf')) return apiError('Expected a .pdf file', 400)
    if (file.size > MAX_SIZE_BYTES) return apiError('File too large', 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    const payout = await parseBoatLocalPayoutPdf(buffer)

    if (!payout.invoiceNumber) return apiError('Could not find an invoice number — is this a BoatLocal operator invoice?', 400)
    if (payout.lines.length === 0) return apiError('No booking lines found in this file', 400)

    const supabase = createAdminClient()

    const { data: existing } = await supabase
      .from('boatlocal_payout_batches')
      .select('id')
      .eq('invoice_number', payout.invoiceNumber)
      .maybeSingle()

    const batchId = existing?.id ?? crypto.randomUUID()
    const storagePath = `boatlocal/${batchId}.pdf`

    const uploadResult = await uploadFinanceAttachment(supabase, storagePath, buffer, 'application/pdf')
    if (!uploadResult.ok) return apiError(`Could not store attachment: ${uploadResult.error}`)

    const { error: batchError } = await supabase
      .from('boatlocal_payout_batches')
      .upsert(
        {
          id: batchId,
          invoice_number: payout.invoiceNumber,
          issue_date: payout.issueDate,
          period_start: payout.periodStart,
          period_end: payout.periodEnd,
          total_sales_incl_vat_cents: payout.totalSalesInclVatCents,
          total_sales_excl_vat_cents: payout.totalSalesExclVatCents,
          commission_ex_vat_cents: payout.commissionExVatCents,
          vat_21_cents: payout.vat21Cents,
          total_withheld_cents: payout.totalWithheldCents,
          operator_payout_cents: payout.operatorPayoutCents,
          vat_9_in_payout_cents: payout.vat9InPayoutCents,
          raw_filename: file.name,
          storage_path: storagePath,
        },
        { onConflict: 'invoice_number' }
      )
    if (batchError) return apiError(batchError.message)

    const { error: linesError, data: insertedLines } = await supabase
      .from('boatlocal_payout_lines')
      .upsert(
        payout.lines.map(line => ({
          batch_id: batchId,
          booking_date: line.bookingDate,
          guest_name: line.guestName,
          guest_count: line.guestCount,
          cruise_name: line.cruiseName,
          total_cents: line.totalCents,
          ex_vat_cents: line.exVatCents,
          incl_vat_cents: line.inclVatCents,
        })),
        { onConflict: 'batch_id,booking_date,guest_name,total_cents', ignoreDuplicates: true }
      )
      .select('id')
    if (linesError) return apiError(linesError.message)

    return apiOk({
      invoiceNumber: payout.invoiceNumber,
      issueDate: payout.issueDate,
      operatorPayoutCents: payout.operatorPayoutCents,
      lineCount: payout.lines.length,
      newLinesStored: insertedLines?.length ?? 0,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
