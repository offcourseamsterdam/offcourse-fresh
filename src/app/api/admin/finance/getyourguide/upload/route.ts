import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseGetYourGuidePaymentPdf } from '@/lib/finance/getyourguide-payment'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'

const MAX_SIZE_BYTES = 2 * 1024 * 1024

/**
 * POST /api/admin/finance/getyourguide/upload
 *
 * Upload a GetYourGuide "Your payment is confirmed" PDF and store the
 * payout for the Finance tab. Safe to re-upload: keyed by payment number,
 * so the same PDF twice is a no-op rather than a duplicate row.
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
    const payment = await parseGetYourGuidePaymentPdf(buffer)

    if (!payment.paymentNumber) return apiError('Could not find a payment number — is this a GetYourGuide payment confirmation?', 400)
    if (payment.amountCents == null) return apiError('Could not find the total payment amount on this file', 400)

    const supabase = createAdminClient()

    const { data: existing } = await supabase
      .from('getyourguide_payments')
      .select('id')
      .eq('payment_number', payment.paymentNumber)
      .maybeSingle()

    const id = existing?.id ?? crypto.randomUUID()
    const storagePath = `getyourguide/${id}.pdf`

    const uploadResult = await uploadFinanceAttachment(supabase, storagePath, buffer, 'application/pdf')
    if (!uploadResult.ok) return apiError(`Could not store attachment: ${uploadResult.error}`)

    const { error } = await supabase
      .from('getyourguide_payments')
      .upsert(
        {
          id,
          payment_number: payment.paymentNumber,
          payment_run_date: payment.paymentRunDate,
          account_number: payment.accountNumber,
          invoice_number: payment.invoiceNumber,
          amount_cents: payment.amountCents,
          raw_filename: file.name,
          storage_path: storagePath,
        },
        { onConflict: 'payment_number' }
      )
    if (error) return apiError(error.message)

    return apiOk({
      paymentNumber: payment.paymentNumber,
      paymentRunDate: payment.paymentRunDate,
      amountCents: payment.amountCents,
      alreadyExisted: !!existing,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
