import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseWithlocalsInvoicePdf } from '@/lib/finance/withlocals-invoice'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'

const MAX_SIZE_BYTES = 2 * 1024 * 1024

/**
 * POST /api/admin/finance/withlocals/upload
 *
 * Upload a Withlocals "New invoice for booking" PDF. Parses the tour, revenue,
 * commission (+21% VAT) and net payout, then upserts the booking keyed by its
 * Withlocals booking id — safe to re-upload the same invoice. If a payout
 * email already created a stub row for this booking, the invoice fills in the
 * detail without wiping the payout_date/guest already stored.
 *
 * Body: FormData { file }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return apiError('file is required', 400)
    if (!file.name.toLowerCase().endsWith('.pdf')) return apiError('Expected a .pdf file', 400)
    if (file.size > MAX_SIZE_BYTES) return apiError('File too large', 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    const invoice = await parseWithlocalsInvoicePdf(buffer)

    if (!invoice.bookingId) return apiError('Could not find a booking id — is this a Withlocals invoice?', 400)
    if (invoice.tourPriceCents == null) return apiError('Could not find the tour price on this invoice', 400)

    const supabase = createAdminClient()

    // The payout email only ever shows an 8-char short id (the invoice's full
    // UUID prefix). If a payout arrived first, it created a stub row keyed by
    // that short id — find it so this upload completes that row instead of
    // creating a duplicate. Exact match covers "invoice arrived first" (or a
    // re-upload); the prefix match covers "payout stub exists".
    const shortId = invoice.bookingId.slice(0, 8)
    const { data: existing, error: lookupError } = await supabase
      .from('withlocals_bookings')
      .select('id, booking_id')
      .or(`booking_id.eq.${invoice.bookingId},booking_id.eq.${shortId}`)
      .maybeSingle()
    // .maybeSingle() errors (rather than silently returning null) if the
    // filter ever matches more than one row — e.g. two unrelated bookings
    // whose ids happen to share an 8-char prefix. Surface that loudly rather
    // than falling through to "not found" and inserting a duplicate row.
    if (lookupError) return apiError(lookupError.message)

    const id = existing?.id ?? crypto.randomUUID()
    const storagePath = `withlocals/${id}.pdf`

    const uploadResult = await uploadFinanceAttachment(supabase, storagePath, buffer, 'application/pdf')
    if (!uploadResult.ok) return apiError(`Could not store attachment: ${uploadResult.error}`)

    // Only the invoice-sourced fields — never touch payout_date/guest_name,
    // which come from the payout email and must survive a (re-)upload.
    // booking_id is upgraded to the full UUID if the existing row was a
    // payout-only stub keyed by the 8-char short id.
    const invoiceFields = {
      booking_id: invoice.bookingId,
      invoice_number: invoice.invoiceNumber,
      invoice_date: invoice.invoiceDate,
      tour_name: invoice.tourName,
      trip_at: invoice.tripAt ? new Date(invoice.tripAt).toISOString() : null,
      guest_count: invoice.guestCount,
      tour_price_cents: invoice.tourPriceCents,
      service_fee_incl_cents: invoice.serviceFeeInclCents,
      service_fee_vat_cents: invoice.serviceFeeVatCents,
      service_fee_ex_cents: invoice.serviceFeeExCents,
      net_payout_cents: invoice.netPayoutCents,
      storage_path: storagePath,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error } = await supabase.from('withlocals_bookings').update(invoiceFields).eq('id', existing.id)
      if (error) return apiError(error.message)
    } else {
      const { error } = await supabase
        .from('withlocals_bookings')
        .insert({ id, ...invoiceFields })
      if (error) return apiError(error.message)
    }

    return apiOk({
      bookingId: invoice.bookingId,
      invoiceNumber: invoice.invoiceNumber,
      tourName: invoice.tourName,
      tourPriceCents: invoice.tourPriceCents,
      netPayoutCents: invoice.netPayoutCents,
      alreadyExisted: !!existing,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
