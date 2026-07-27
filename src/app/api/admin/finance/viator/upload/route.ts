import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseViatorPaymentAdviceFile } from '@/lib/finance/viator-payment-advice'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'

const MAX_SIZE_BYTES = 2 * 1024 * 1024 // 2MB — these advices are small, plain data sheets

/**
 * POST /api/admin/finance/viator/upload
 *
 * Upload a Viator "Payment Advice" .xlsx (the monthly remittance email
 * attachment) and store its batch total + line items for the Finance tab.
 * Safe to re-upload the same file: the batch is keyed by (document number,
 * advice date) — Viator reuses the same document number every month, so
 * the advice date is what actually distinguishes one payout from the next —
 * and lines are keyed by (batch, reference, converted amount), so
 * duplicates are silently skipped rather than double-counted.
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
    if (!file.name.toLowerCase().endsWith('.xlsx')) return apiError('Expected a .xlsx file', 400)
    if (file.size > MAX_SIZE_BYTES) return apiError('File too large', 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    const advice = await parseViatorPaymentAdviceFile(buffer, file.name)

    if (!advice.documentNumber) return apiError('Could not find a document number — is this a Viator payment advice?', 400)
    if (!advice.adviceDate) return apiError('Could not find the advice date on this file', 400)
    if (advice.lines.length === 0) return apiError('No line items found in this file', 400)

    const supabase = createAdminClient()

    const { data: existingBatch } = await supabase
      .from('viator_payment_batches')
      .select('id')
      .eq('document_number', advice.documentNumber)
      .eq('advice_date', advice.adviceDate)
      .maybeSingle()

    const batchId = existingBatch?.id ?? crypto.randomUUID()
    const storagePath = `viator/${batchId}.xlsx`

    const uploadResult = await uploadFinanceAttachment(supabase, storagePath, buffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    if (!uploadResult.ok) return apiError(`Could not store attachment: ${uploadResult.error}`)

    const { error: batchError } = await supabase
      .from('viator_payment_batches')
      .upsert(
        {
          id: batchId,
          document_number: advice.documentNumber,
          advice_date: advice.adviceDate,
          total_amount_cents: advice.totalAmountCents,
          raw_filename: file.name,
          storage_path: storagePath,
        },
        { onConflict: 'document_number,advice_date' }
      )
    if (batchError) return apiError(batchError.message)

    const { error: linesError, data: insertedLines } = await supabase
      .from('viator_payment_lines')
      .upsert(
        advice.lines.map(line => ({
          batch_id: batchId,
          viator_reference: line.viatorReference,
          arrival_date: line.arrivalDate,
          sale_date: line.saleDate,
          vendor_reference: line.vendorReference,
          gross_amount: line.grossAmount,
          gross_currency: line.grossCurrency,
          converted_amount_cents: line.convertedAmountCents,
          tour_grade_code: line.tourGradeCode,
          tour_grade_title: line.tourGradeTitle,
        })),
        { onConflict: 'batch_id,viator_reference,converted_amount_cents', ignoreDuplicates: true }
      )
      .select('id')
    if (linesError) return apiError(linesError.message)

    return apiOk({
      documentNumber: advice.documentNumber,
      adviceDate: advice.adviceDate,
      totalAmountCents: advice.totalAmountCents,
      lineCount: advice.lines.length,
      newLinesStored: insertedLines?.length ?? 0,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
