import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'
import { Resend } from 'resend'
import { paymentLinkEmailHtml } from '@/emails/PaymentLinkEmail'
import { format } from 'date-fns'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      availPk,
      customerTypeRatePk,
      guestCount,
      category,
      contact,
      note,
      listingId,
      listingTitle,
      date,
      startAt,
      endAt,
      extrasSelected,
      overrideAmountCents,
    } = body

    if (!availPk || !customerTypeRatePk || !guestCount || !contact?.name || !contact?.email || !contact?.phone) {
      return apiError('Missing required fields: availPk, customerTypeRatePk, guestCount, contact.name, contact.email, contact.phone', 400)
    }
    if (!overrideAmountCents || Number(overrideAmountCents) < 100) {
      return apiError('overrideAmountCents must be at least 100 (€1.00)', 400)
    }

    const fh = getFareHarborClient()
    const isPrivate = category === 'private'
    const customerCount = isPrivate ? 1 : Number(guestCount)
    const customers = Array.from({ length: customerCount }, () => ({
      customer_type_rate: Number(customerTypeRatePk),
    }))
    const bookingData = {
      contact: {
        name: String(contact.name),
        phone: String(contact.phone),
        email: String(contact.email),
      },
      customers,
      note: note ? String(note) : undefined,
    }

    // Step 1: Validate FareHarbor availability
    const validation = await fh.validateBooking(Number(availPk), bookingData)
    if (!validation.is_bookable) {
      return apiError(validation.error ?? 'Slot is not available', 422)
    }

    // Step 2: Create FareHarbor booking (reserves the slot immediately)
    const fhBooking = await fh.createBooking(Number(availPk), bookingData)

    // Step 3: Create Stripe Checkout Session with 24h expiry
    const stripe = getStripe()
    const expiresAt = Math.floor(Date.now() / 1000) + 86400
    const startTimeFormatted = startAt ? format(new Date(startAt), 'HH:mm') : ''
    const dateFormatted = date ? format(new Date(date), 'd MMMM yyyy') : ''

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            unit_amount: Number(overrideAmountCents),
            product_data: {
              name: `${listingTitle} — ${dateFormatted} ${startTimeFormatted}`.trim(),
              description: `${guestCount} ${Number(guestCount) === 1 ? 'guest' : 'guests'}`,
            },
          },
          quantity: 1,
        },
      ],
      expires_at: expiresAt,
      customer_email: contact.email,
      metadata: {
        fareharbor_uuid: fhBooking?.uuid ?? '',
        listing_id: listingId ?? '',
        booking_source: 'payment_link',
      },
      success_url: `${SITE_URL}/betaald?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/betaald?cancelled=1`,
      payment_method_types: ['card', 'ideal'],
    })

    // Step 4: Save booking to Supabase
    const supabase = createAdminClient()
    const bookingId = fhBooking?.uuid ?? `pl_${Date.now()}`
    const { data: savedBooking, error: dbError } = await supabase
      .from('bookings')
      .insert({
        booking_id: bookingId,
        booking_uuid: fhBooking?.uuid ?? null,
        fareharbor_availability_pk: Number(availPk),
        fareharbor_customer_type_rate_pk: Number(customerTypeRatePk),
        stripe_session_id: session.id,
        stripe_amount: Number(overrideAmountCents),
        base_amount_cents: Number(overrideAmountCents),
        base_vat_rate: 9,
        base_vat_amount_cents: 0,
        extras_amount_cents: 0,
        extras_vat_amount_cents: 0,
        total_vat_amount_cents: 0,
        extras_selected: (extrasSelected ?? []) as never,
        listing_id: listingId ?? null,
        listing_title: String(listingTitle ?? ''),
        category: String(category ?? 'private'),
        booking_date: date || null,
        start_time: startAt ?? null,
        end_time: endAt ?? null,
        guest_count: Number(guestCount),
        customer_name: contact.name,
        customer_email: contact.email,
        customer_phone: contact.phone,
        guest_note: note || null,
        status: 'confirmed',
        payment_status: 'pending_payment',
        currency: 'eur',
        booking_source: 'payment_link',
        payment_link_expires_at: new Date(expiresAt * 1000).toISOString(),
        payment_reminder_sent: false,
      })
      .select('id')
      .single()

    if (dbError) {
      // FH booking + Stripe session created but DB save failed — log loudly
      console.error('[create-payment-link] Supabase insert failed. FH UUID:', fhBooking?.uuid, 'Session:', session.id, dbError)
    }

    // Step 5: Send payment link email to customer
    const resend = new Resend(process.env.RESEND_API_KEY!)
    await resend.emails.send({
      from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
      to: contact.email,
      subject: 'Your booking at Off Course Amsterdam — pay to confirm',
      html: paymentLinkEmailHtml({
        customerName: contact.name,
        listingTitle: String(listingTitle ?? ''),
        bookingDate: dateFormatted,
        startTime: startTimeFormatted,
        guestCount: Number(guestCount),
        amountCents: Number(overrideAmountCents),
        paymentUrl: session.url!,
      }),
    })

    return apiOk({
      bookingId: savedBooking?.id ?? bookingId,
      paymentUrl: session.url,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    })
  } catch (err) {
    console.error('[create-payment-link] Error:', err)
    return apiError(err instanceof Error ? err.message : 'Internal error', 500)
  }
}
