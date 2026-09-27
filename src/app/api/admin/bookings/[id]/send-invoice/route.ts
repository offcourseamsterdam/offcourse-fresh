import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { issueStripeInvoiceForBooking } from '@/lib/stripe/issue-booking-invoice'

interface SendInvoiceBody {
  companyName?: string
  kvkNumber?: string | null
  vatNumber?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  addressLine1?: string | null
  postalCode?: string | null
  city?: string | null
  countryCode?: string | null
  daysAfterTour?: number
  listingTitle?: string
  baseAmountCents?: number
  deductPartnerCommission?: boolean
}

/**
 * POST /api/admin/bookings/[id]/send-invoice
 *
 * Sends the Stripe Invoice afterwards for an existing "Invoice later" booking
 * (e.g. when sending it at booking time failed).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as SendInvoiceBody

    const result = await issueStripeInvoiceForBooking(
      id,
      {
        companyName: body.companyName ?? '',
        kvkNumber: body.kvkNumber,
        vatNumber: body.vatNumber,
        contactName: body.contactName,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        addressLine1: body.addressLine1,
        postalCode: body.postalCode,
        city: body.city,
        countryCode: body.countryCode,
      },
      {
        daysAfterTour: body.daysAfterTour,
        listingTitle: body.listingTitle,
        baseAmountCents: body.baseAmountCents,
        deductPartnerCommission: body.deductPartnerCommission,
      },
    )

    if (!result.ok) return apiError(result.error, result.status)

    return apiOk({
      ok: true,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      hostedInvoiceUrl: result.hostedInvoiceUrl,
      pdfUrl: result.pdfUrl,
      dueDate: result.dueDate,
      amountDueCents: result.amountDueCents,
    })
  } catch (err) {
    console.error('[send-invoice] Error sending invoice:', err)
    return apiError(err instanceof Error ? err.message : 'Fout bij versturen van factuur', 500)
  }
}
