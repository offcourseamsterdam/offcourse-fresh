import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { FHNotFoundError } from '@/lib/fareharbor/types'
import { sendRescheduleEmail } from '@/lib/booking/send-confirmation-email'
import { postSlackText } from '@/lib/slack/send-notification'
import { formatAmsterdamTime } from '@/lib/utils'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = await request.json()
    const { newAvailPk, newCustomerTypeRatePk, newCustomerTypeName, newDate, newStartAt, newEndAt, sendEmail } = body as {
      newAvailPk: number
      newCustomerTypeRatePk: number
      newCustomerTypeName?: string
      newDate: string
      newStartAt: string
      newEndAt: string
      sendEmail?: boolean
    }

    if (!newAvailPk || !newCustomerTypeRatePk || !newDate) {
      return apiError('newAvailPk, newCustomerTypeRatePk, and newDate are required', 400)
    }

    const supabase = createAdminClient()
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_uuid, status, customer_name, customer_email, customer_phone, guest_note, category, guest_count, listing_title, base_amount_cents, booking_date, start_time')
      .eq('id', id)
      .single()

    if (!booking) return apiError('Booking not found', 404)
    if (booking.status === 'cancelled') return apiError('Cannot rebook a cancelled booking', 409)

    const fh = getFareHarborClient()
    const isPrivate = booking.category === 'private'
    const customerCount = isPrivate ? 1 : Number(booking.guest_count ?? 1)

    const bookingData = {
      contact: {
        name: booking.customer_name ?? '',
        phone: booking.customer_phone ?? '',
        email: booking.customer_email ?? '',
      },
      customers: Array.from({ length: customerCount }, () => ({
        customer_type_rate: Number(newCustomerTypeRatePk),
      })),
      note: booking.guest_note ?? undefined,
    }

    // Validate new slot first
    const validation = await fh.validateBooking(newAvailPk, bookingData)
    if (!validation.is_bookable) {
      return apiError(validation.error ?? 'New slot is not available', 422)
    }

    // Create the new FH booking first, linking it to the old one via the `rebooking` field.
    // This tells FareHarbor it's a reschedule (not a new booking) so it sends a rescheduled
    // notification instead of a "new booking confirmed" email. FH also uses the link to
    // release the old slot's resource before allocating the new one, avoiding the
    // "Unable to satisfy resources" conflict we previously worked around by cancelling first.
    // If there's no old FH UUID (admin-created booking), fall back to a plain createBooking.
    let newFhBooking
    try {
      if (booking.booking_uuid) {
        newFhBooking = await fh.rebookBooking(newAvailPk, bookingData, booking.booking_uuid)
      } else {
        newFhBooking = await fh.createBooking(newAvailPk, bookingData)
      }
    } catch (err) {
      console.error('[rebook] FH booking creation failed:', err)
      throw err
    }

    // Cancel the old FH booking now that the new one is confirmed.
    // FH may already have handled this internally via the rebooking link, but we
    // cancel explicitly to be safe. FHNotFoundError = already gone, ignore it.
    if (booking.booking_uuid) {
      try {
        await fh.cancelBooking(booking.booking_uuid)
      } catch (err) {
        if (!(err instanceof FHNotFoundError)) throw err
        // Already cleaned up by FH — continue
      }
    }

    // Update Supabase — log new UUID before attempting so it's recoverable if this fails
    console.log('[rebook] new FH booking created:', newFhBooking.uuid, 'replacing:', booking.booking_uuid)
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        booking_uuid: newFhBooking.uuid,
        fareharbor_availability_pk: newAvailPk,
        fareharbor_customer_type_rate_pk: newCustomerTypeRatePk,
        ...(newCustomerTypeName ? { customer_type_name: newCustomerTypeName } : {}),
        booking_date: newDate,
        start_time: newStartAt,
        end_time: newEndAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) return apiError(updateError.message)

    // Slack — best-effort, never blocks the response
    postSlackText([
      `📅 *Booking rescheduled (admin)*`,
      `*${booking.listing_title ?? 'Canal Cruise'}*`,
      `👤 ${booking.customer_name ?? '—'} · ${booking.customer_email ?? '—'}`,
      `${booking.booking_date ?? '—'} → ${newDate} · ${formatAmsterdamTime(newStartAt)}`,
      `🎫 FH: ${newFhBooking.uuid}`,
    ].join('\n')).catch(err => console.error('[rebook] Slack error (ignored):', err))

    // Send reschedule confirmation email — only when explicitly requested
    if (sendEmail !== false) sendRescheduleEmail({
      contact: {
        name: booking.customer_name ?? '',
        email: booking.customer_email ?? '',
      },
      listingTitle:  booking.listing_title ?? 'Canal Cruise',
      newDate:       newDate,
      newStartAt:    newStartAt ?? null,
      newEndAt:      newEndAt ?? null,
      guestCount:    Number(booking.guest_count ?? 1),
      amountCents:   Number(booking.base_amount_cents ?? 0),
      fhBookingUuid: newFhBooking.uuid,
      category:      booking.category,
      fareharborCustomerTypeRatePk: newCustomerTypeRatePk,
    }).catch(err => console.error('[rebook] reschedule email error (ignored):', err))

    return apiOk({ rebooked: true, newBookingUuid: newFhBooking.uuid })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
