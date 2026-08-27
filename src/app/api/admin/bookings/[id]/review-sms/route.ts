import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatReviewSms } from '@/lib/sms/format-message'
import { sendTwilioSms, normalizePhoneNumber } from '@/lib/twilio/client'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { SITE_MAP_URL, reviewUrlForBooking } from '@/lib/sms/urls'
import { getCaptainFirstNames } from '@/lib/scheduling/assigned-captain'

/**
 * GET /api/admin/bookings/[id]/review-sms
 * Returns booking details, rendered SMS preview, and delivery status.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const supabase = createAdminClient()

  const [bookingRes, configRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, customer_name, customer_phone, customer_email, listing_title, review_sms_sent_at, review_sms_phone, review_sms_sid, fareharbor_availability_pk')
      .eq('id', id)
      .single(),
    supabase
      .from('google_reviews_config')
      .select('review_sms_template, review_sms_enabled')
      .limit(1)
      .maybeSingle(),
  ])

  if (bookingRes.error) {
    console.error('[review-sms] GET booking query failed:', bookingRes.error)
    return apiError('Booking not found', 404)
  }
  if (!bookingRes.data) {
    return apiError('Booking not found', 404)
  }

  const booking = bookingRes.data
  const config = configRes.data

  const captainNames = await getCaptainFirstNames(supabase, [
    { id: booking.id, fareharbor_availability_pk: booking.fareharbor_availability_pk },
  ])

  const message = formatReviewSms({
    customerName: booking.customer_name,
    listingTitle: booking.listing_title,
    mapUrl: SITE_MAP_URL,
    reviewUrl: reviewUrlForBooking(booking.id),
    captainName: captainNames.get(booking.id),
    template: config?.review_sms_template,
  })

  const rawPhone = booking.customer_phone || ''
  const normalizedPhone = normalizePhoneNumber(rawPhone)

  return apiOk({
    booking,
    preview: {
      message,
      rawPhone,
      normalizedPhone,
      alreadySent: Boolean(booking.review_sms_sent_at),
      sentAt: booking.review_sms_sent_at,
      smsEnabled: config?.review_sms_enabled ?? true,
    },
  })
}

/**
 * POST /api/admin/bookings/[id]/review-sms
 * Sends post-cruise SMS via Twilio and updates booking idempotency timestamp.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const { phone, message, force } = body

  const supabase = createAdminClient()

  const [bookingRes, configRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, customer_name, customer_phone, listing_title, review_sms_sent_at, fareharbor_availability_pk')
      .eq('id', id)
      .single(),
    supabase
      .from('google_reviews_config')
      .select('review_sms_template, review_sms_enabled')
      .limit(1)
      .maybeSingle(),
  ])

  if (bookingRes.error) {
    console.error('[review-sms] POST booking query failed:', bookingRes.error)
    return apiError('Booking not found', 404)
  }
  if (!bookingRes.data) {
    return apiError('Booking not found', 404)
  }

  const booking = bookingRes.data
  const config = configRes.data

  if (booking.review_sms_sent_at && !force) {
    return apiError('Review SMS already sent to this booking', 409)
  }

  const targetPhone = typeof phone === 'string' && phone.trim() ? phone.trim() : booking.customer_phone
  if (!targetPhone) {
    return apiError('Customer phone number is required', 400)
  }

  const normalizedPhone = normalizePhoneNumber(targetPhone)
  if (!normalizedPhone) {
    return apiError(`Invalid phone number format: ${targetPhone}`, 400)
  }

  const messageBody = typeof message === 'string' && message.trim()
    ? message.trim()
    : formatReviewSms({
        customerName: booking.customer_name,
        listingTitle: booking.listing_title,
        mapUrl: SITE_MAP_URL,
        reviewUrl: reviewUrlForBooking(booking.id),
        captainName: (await getCaptainFirstNames(supabase, [
          { id: booking.id, fareharbor_availability_pk: booking.fareharbor_availability_pk },
        ])).get(booking.id),
        template: config?.review_sms_template,
      })

  const sendResult = await sendTwilioSms({
    to: normalizedPhone,
    body: messageBody,
  })

  if (!sendResult.success) {
    return apiError(sendResult.error || 'Failed to dispatch Twilio SMS', 500)
  }

  const sentAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('bookings')
    .update({
      review_sms_sent_at: sentAt,
      review_sms_phone: normalizedPhone,
      review_sms_sid: sendResult.sid || null,
      updated_at: sentAt,
    })
    .eq('id', id)

  if (updateError) {
    console.error('[review-sms] Booking update failed after SMS send:', updateError)
  }

  await notifyBookingsChanged().catch(() => {})

  return apiOk({
    sent: true,
    sid: sendResult.sid,
    phone: normalizedPhone,
    sentAt,
    mock: sendResult.mock,
  })
}
