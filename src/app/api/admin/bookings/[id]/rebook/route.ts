import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { FHNotFoundError } from '@/lib/fareharbor/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { newAvailPk, newCustomerTypeRatePk, newDate, newStartAt, newEndAt } = body as {
      newAvailPk: number
      newCustomerTypeRatePk: number
      newDate: string
      newStartAt: string
      newEndAt: string
    }

    if (!newAvailPk || !newCustomerTypeRatePk || !newDate) {
      return apiError('newAvailPk, newCustomerTypeRatePk, and newDate are required', 400)
    }

    const supabase = createAdminClient()
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_uuid, status, customer_name, customer_email, customer_phone, guest_note, category, guest_count')
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

    // Create new FH booking (with rebooking link to old if we have one)
    let newFhBooking
    if (booking.booking_uuid) {
      newFhBooking = await fh.rebookBooking(newAvailPk, bookingData, booking.booking_uuid)
    } else {
      newFhBooking = await fh.createBooking(newAvailPk, bookingData)
    }

    // Cancel original FH booking after new one is safely created
    if (booking.booking_uuid) {
      try {
        await fh.cancelBooking(booking.booking_uuid)
      } catch (err) {
        if (!(err instanceof FHNotFoundError)) throw err
        // Already gone in FH — continue
      }
    }

    // Update Supabase record in-place with new slot details
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        booking_uuid: newFhBooking.uuid,
        fareharbor_availability_pk: newAvailPk,
        fareharbor_customer_type_rate_pk: newCustomerTypeRatePk,
        booking_date: newDate,
        start_time: newStartAt,
        end_time: newEndAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) return apiError(updateError.message)

    return apiOk({ rebooked: true, newBookingUuid: newFhBooking.uuid })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
