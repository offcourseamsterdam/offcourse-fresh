import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getOrCreateStripeCustomer,
  createAndSendStripeInvoice,
  type BusinessCustomerInput,
} from '@/lib/stripe/invoicing'
import { postSlackOps } from '@/lib/slack/send-notification'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { formatAmsterdamTime } from '@/lib/utils'
import { CITY_TAX_CENTS_PER_GUEST } from '@/lib/booking/constants'

interface SendInvoiceBody {
  companyName: string
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
}

/**
 * POST /api/admin/bookings/[id]/send-invoice
 *
 * Generates and sends a Stripe Invoice in retrospect for an existing booking.
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

    const supabase = createAdminClient()
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !booking) {
      return apiError('Booking niet gevonden', 404)
    }

    if (booking.status === 'cancelled') {
      return apiError('Kan geen factuur sturen voor een geannuleerde boeking', 400)
    }

    if (booking.payment_status === 'paid') {
      return apiError('Deze boeking is al gemarkeerd als betaald', 400)
    }

    if (booking.stripe_invoice_id) {
      return apiError('Er is al een actieve Stripe factuur gekoppeld aan deze boeking', 400)
    }

    const companyName = (body.companyName || booking.company_name || booking.customer_name || '').trim()
    const contactEmail = (body.contactEmail || booking.customer_email || '').trim()
    const contactName = (body.contactName || booking.customer_name || '').trim()
    const contactPhone = (body.contactPhone || booking.customer_phone || '').trim()
    const kvkNumber = (body.kvkNumber || booking.company_kvk || '').trim() || null
    const vatNumber = (body.vatNumber || booking.company_vat || '').trim() || null
    const addressLine1 = (body.addressLine1 || '').trim() || null
    const postalCode = (body.postalCode || '').trim() || null
    const city = (body.city || '').trim() || null
    const countryCode = (body.countryCode || 'NL').trim().toUpperCase()

    if (!companyName) {
      return apiError('Bedrijfsnaam is verplicht om een factuur te sturen', 400)
    }
    if (!contactEmail) {
      return apiError('E-mailadres is verplicht om de factuur te versturen', 400)
    }

    // 1. Provision or update Stripe Customer
    const customerInput: BusinessCustomerInput = {
      name: contactName || companyName,
      email: contactEmail,
      phone: contactPhone || null,
      companyName,
      kvkNumber,
      vatNumber,
      address: {
        line1: addressLine1,
        postal_code: postalCode,
        city: city,
        country: countryCode,
      },
    }

    const stripeCustomer = await getOrCreateStripeCustomer(customerInput)

    // 2. Parse extras line items from booking
    const extrasRaw = Array.isArray(booking.extras_selected)
      ? (booking.extras_selected as Array<{ name: string; amount_cents?: number; price_cents?: number; quantity?: number }>)
      : []
    const extrasList = extrasRaw.map(e => ({
      name: e.name,
      amount_cents: e.amount_cents ?? ((e.price_cents ?? 0) * (e.quantity ?? 1)),
    }))

    const guestCount = Math.max(1, Number(booking.guest_count ?? 1))
    const cityTaxCents = guestCount * CITY_TAX_CENTS_PER_GUEST
    const bookingDate = booking.booking_date || new Date().toISOString().slice(0, 10)

    // 3. Create, finalize and send invoice via Stripe
    const invoiceResult = await createAndSendStripeInvoice({
      customerId: stripeCustomer.id,
      bookingId: booking.booking_id || booking.id,
      fhBookingUuid: booking.booking_uuid,
      listingTitle: (body.listingTitle || booking.listing_title || 'Private Boat Tour Amsterdam').trim(),
      bookingDate,
      startTime: booking.start_time,
      guestCount,
      baseAmountCents: body.baseAmountCents != null ? Number(body.baseAmountCents) : (booking.base_amount_cents ?? 0),
      extrasSelected: extrasList,
      cityTaxCents,
      discountAmountCents: booking.discount_amount_cents ?? 0,
      category: booking.category,
      note: booking.guest_note,
      daysAfterTour: body.daysAfterTour ?? 14,
    })

    // 4. Upsert business profile directory entry
    let businessProfileId: string | null = null
    try {
      const formattedAddr = [addressLine1, postalCode, city].filter(Boolean).join(', ')
      const { data: profile } = await supabase
        .from('business_profiles')
        .upsert(
          {
            company_name: companyName,
            kvk_number: kvkNumber,
            vat_number: vatNumber,
            contact_name: contactName,
            contact_email: contactEmail,
            contact_phone: contactPhone,
            address_line1: addressLine1 || '',
            postal_code: postalCode || '',
            city: city || 'Amsterdam',
            country_code: countryCode,
            stripe_customer_id: stripeCustomer.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'company_name' }
        )
        .select('id')
        .single()
      businessProfileId = profile?.id ?? null
    } catch (profErr) {
      console.warn('[send-invoice] business_profiles upsert failed (non-fatal):', profErr)
    }

    const companyAddressStr = [addressLine1, postalCode, city, countryCode].filter(Boolean).join(', ')

    // 5. Update booking record with invoice reference
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        stripe_invoice_id: invoiceResult.invoiceId,
        stripe_invoice_url: invoiceResult.hostedInvoiceUrl,
        stripe_customer_id: stripeCustomer.id,
        business_profile_id: businessProfileId,
        company_name: companyName,
        company_kvk: kvkNumber,
        company_vat: vatNumber,
        company_address: companyAddressStr || null,
        invoice_due_date: invoiceResult.dueDate,
        payment_status: 'stripe_invoice_sent',
        stripe_amount: invoiceResult.amountDueCents,
        booking_source: booking.booking_source || 'stripe_invoice',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      console.error('[send-invoice] Failed to update booking record:', updateError)
      return apiError('Factuur is verstuurd via Stripe, maar boeking update mislukt: ' + updateError.message, 500)
    }

    await notifyBookingsChanged()

    // 6. Slack Ops Alert
    postSlackOps([
      `🧾 *Stripe Factuur Verstuurd (Achteraf)*`,
      `*${booking.listing_title ?? 'Private Boat Tour'}*`,
      `🏢 *${companyName}* ${kvkNumber ? `(KVK: ${kvkNumber})` : ''}`,
      `👤 ${contactName} · ${contactEmail}`,
      `📅 Tourdatum: ${bookingDate} · ${formatAmsterdamTime(booking.start_time)}`,
      `⏳ Vervaldatum: *${invoiceResult.dueDate}*`,
      `💶 Bedrag: *€${(invoiceResult.amountDueCents / 100).toFixed(2)}*`,
      invoiceResult.hostedInvoiceUrl ? `🔗 Factuur: ${invoiceResult.hostedInvoiceUrl}` : '',
    ].filter(Boolean).join('\n')).catch(err => console.error('[send-invoice] Slack error (ignored):', err))

    return apiOk({
      ok: true,
      invoiceId: invoiceResult.invoiceId,
      invoiceNumber: invoiceResult.invoiceNumber,
      hostedInvoiceUrl: invoiceResult.hostedInvoiceUrl,
      pdfUrl: invoiceResult.pdfUrl,
      dueDate: invoiceResult.dueDate,
      amountDueCents: invoiceResult.amountDueCents,
    })
  } catch (err) {
    console.error('[send-invoice] Error sending invoice:', err)
    return apiError(err instanceof Error ? err.message : 'Fout bij versturen van factuur', 500)
  }
}
