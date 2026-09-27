import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateStripeCustomer, createAndSendStripeInvoice } from '@/lib/stripe/invoicing'
import { postSlackOps } from '@/lib/slack/send-notification'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { formatAmsterdamTime } from '@/lib/utils'
import { CITY_TAX_CENTS_PER_GUEST } from '@/lib/booking/constants'
import { allocateInvoiceNumber } from '@/lib/booking/allocate-invoice-number'

/** The only booking source that gets a real Stripe Invoice. */
export const STRIPE_INVOICE_BOOKING_SOURCE = 'invoice_later'

export interface InvoiceBillingDetails {
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
}

export interface IssueBookingInvoiceOptions {
  daysAfterTour?: number
  listingTitle?: string
  baseAmountCents?: number
  deductPartnerCommission?: boolean
}

export type IssueBookingInvoiceResult =
  | {
      ok: true
      invoiceId: string
      invoiceNumber: string | null
      hostedInvoiceUrl: string | null
      pdfUrl: string | null
      dueDate: string
      amountDueCents: number
    }
  | { ok: false; status: number; error: string }

/**
 * Create, finalize and email a Stripe Invoice for an existing booking row, then
 * link it to the row. Used both right after an "Invoice later" booking is created
 * and when an admin sends one afterwards from the booking detail row.
 */
export async function issueStripeInvoiceForBooking(
  bookingRowId: string,
  billing: InvoiceBillingDetails,
  options: IssueBookingInvoiceOptions = {},
): Promise<IssueBookingInvoiceResult> {
  const supabase = createAdminClient()
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingRowId)
    .single()

  if (fetchError || !booking) {
    return { ok: false, status: 404, error: 'Booking niet gevonden' }
  }
  if (booking.status === 'cancelled') {
    return { ok: false, status: 400, error: 'Kan geen factuur sturen voor een geannuleerde boeking' }
  }
  if (booking.booking_source !== STRIPE_INVOICE_BOOKING_SOURCE) {
    return { ok: false, status: 400, error: 'Een Stripe factuur kan alleen worden verstuurd voor boekingen met bron "Invoice later"' }
  }
  if (booking.payment_status === 'paid') {
    return { ok: false, status: 400, error: 'Deze boeking is al gemarkeerd als betaald' }
  }
  if (booking.stripe_invoice_id) {
    return { ok: false, status: 400, error: 'Er is al een actieve Stripe factuur gekoppeld aan deze boeking' }
  }

  const companyName = (billing.companyName || booking.company_name || booking.customer_name || '').trim()
  const contactEmail = (billing.contactEmail || booking.customer_email || '').trim()
  const contactName = (billing.contactName || booking.customer_name || '').trim()
  const contactPhone = (billing.contactPhone || booking.customer_phone || '').trim()
  const kvkNumber = (billing.kvkNumber || booking.company_kvk || '').trim() || null
  const vatNumber = (billing.vatNumber || booking.company_vat || '').trim() || null
  const addressLine1 = (billing.addressLine1 || '').trim() || null
  const postalCode = (billing.postalCode || '').trim() || null
  const city = (billing.city || '').trim() || null
  const countryCode = (billing.countryCode || 'NL').trim().toUpperCase()

  if (!companyName) {
    return { ok: false, status: 400, error: 'Bedrijfsnaam is verplicht om een factuur te sturen' }
  }
  if (!contactEmail) {
    return { ok: false, status: 400, error: 'E-mailadres is verplicht om de factuur te versturen' }
  }

  const stripeCustomer = await getOrCreateStripeCustomer({
    name: contactName || companyName,
    email: contactEmail,
    phone: contactPhone || null,
    companyName,
    kvkNumber,
    vatNumber,
    address: { line1: addressLine1, postal_code: postalCode, city, country: countryCode },
  })

  const extrasRaw = Array.isArray(booking.extras_selected)
    ? (booking.extras_selected as Array<{ name: string; amount_cents?: number; price_cents?: number; quantity?: number }>)
    : []
  const extrasList = extrasRaw.map(e => ({
    name: e.name,
    amount_cents: e.amount_cents ?? ((e.price_cents ?? 0) * (e.quantity ?? 1)),
  }))

  const guestCount = Math.max(1, Number(booking.guest_count ?? 1))
  const bookingDate = booking.booking_date || new Date().toISOString().slice(0, 10)
  const baseAmountCents = options.baseAmountCents != null ? Number(options.baseAmountCents) : (booking.base_amount_cents ?? 0)

  // Sequential invoice number (OC-2026-00070) shared with the confirmation-email
  // PDFs, keyed on a PI ref. Invoice bookings have no PI yet, so reserve a stable
  // placeholder first; invoice.paid later overwrites it with the real PI.
  let invoiceNumber: string | null = booking.invoice_number ?? null
  if (!invoiceNumber) {
    const piRef = booking.stripe_payment_intent_id || `b2b_${booking.id}`
    if (!booking.stripe_payment_intent_id) {
      await supabase.from('bookings').update({ stripe_payment_intent_id: piRef }).eq('id', booking.id)
    }
    invoiceNumber = await allocateInvoiceNumber(piRef)
  }

  let partnerCommission: {
    partnerName: string
    commissionRate: number
    commissionAmountCents: number
    baseExVatCents: number
  } | null = null

  if (options.deductPartnerCommission !== false && booking.partner_id && (booking.commission_amount_cents ?? 0) > 0) {
    const { data: partner } = await supabase
      .from('partners')
      .select('name, commission_rate')
      .eq('id', booking.partner_id)
      .maybeSingle()

    partnerCommission = {
      partnerName: partner?.name || 'Partner',
      commissionRate: Number(partner?.commission_rate ?? 20),
      commissionAmountCents: Number(booking.commission_amount_cents),
      baseExVatCents: Math.round(baseAmountCents / 1.09),
    }
  }

  const invoiceResult = await createAndSendStripeInvoice({
    customerId: stripeCustomer.id,
    bookingId: booking.booking_id || booking.id,
    fhBookingUuid: booking.booking_uuid,
    listingTitle: (options.listingTitle || booking.listing_title || 'Private Boat Tour Amsterdam').trim(),
    bookingDate,
    startTime: booking.start_time,
    guestCount,
    baseAmountCents,
    extrasSelected: extrasList,
    cityTaxCents: guestCount * CITY_TAX_CENTS_PER_GUEST,
    discountAmountCents: booking.discount_amount_cents ?? 0,
    partnerCommission,
    category: booking.category,
    note: booking.guest_note,
    daysAfterTour: options.daysAfterTour ?? 14,
    invoiceNumber,
  })

  let businessProfileId: string | null = null
  try {
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
        { onConflict: 'company_name' },
      )
      .select('id')
      .single()
    businessProfileId = profile?.id ?? null
  } catch (profErr) {
    console.warn('[issue-booking-invoice] business_profiles upsert failed (non-fatal):', profErr)
  }

  const companyAddress = [addressLine1, postalCode, city, countryCode].filter(Boolean).join(', ')

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
      company_address: companyAddress || null,
      invoice_due_date: invoiceResult.dueDate,
      invoice_number: invoiceNumber || invoiceResult.invoiceNumber,
      payment_status: 'stripe_invoice_sent',
      stripe_amount: invoiceResult.amountDueCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', booking.id)

  if (updateError) {
    console.error('[issue-booking-invoice] Failed to link invoice to booking:', updateError)
    return {
      ok: false,
      status: 500,
      error: `Factuur ${invoiceResult.invoiceId} is verstuurd via Stripe, maar boeking update mislukt: ${updateError.message}`,
    }
  }

  await notifyBookingsChanged()

  postSlackOps([
    `🧾 *Stripe factuur verstuurd*`,
    `*${booking.listing_title ?? 'Private Boat Tour'}*`,
    `🏢 *${companyName}* ${kvkNumber ? `(KVK: ${kvkNumber})` : ''}`,
    partnerCommission ? `🤝 Partnerkorting: ${partnerCommission.partnerName}` : '',
    `👤 ${contactName} · ${contactEmail}`,
    `📅 Tourdatum: ${bookingDate} · ${formatAmsterdamTime(booking.start_time)}`,
    `⏳ Vervaldatum: *${invoiceResult.dueDate}*`,
    `💶 Bedrag: *€${(invoiceResult.amountDueCents / 100).toFixed(2)}*`,
    invoiceResult.hostedInvoiceUrl ? `🔗 Factuur: ${invoiceResult.hostedInvoiceUrl}` : '',
  ].filter(Boolean).join('\n')).catch(err => console.error('[issue-booking-invoice] Slack error (ignored):', err))

  return {
    ok: true,
    invoiceId: invoiceResult.invoiceId,
    invoiceNumber: invoiceNumber || invoiceResult.invoiceNumber,
    hostedInvoiceUrl: invoiceResult.hostedInvoiceUrl,
    pdfUrl: invoiceResult.pdfUrl,
    dueDate: invoiceResult.dueDate,
    amountDueCents: invoiceResult.amountDueCents,
  }
}
