import { amsterdamTimeToUtcIso } from '@/lib/utils'
import type { BookingSource } from '@/lib/constants'

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>

export interface ImportableBooking {
  bookingPk: number
  bookingSource: BookingSource
  guestName: string | null
  guestEmail: string | null
  guestPhone: string | null
  dateISO: string | null
  /** Wall-clock HH:MM in Amsterdam time, exactly as the notification wrote it. */
  time: string | null
  endTime: string | null
  guests: number | null
  experienceName: string | null
}

export type ImportBookingResult =
  | { ok: true; bookingId: string; date: string }
  | { ok: false; error: string }

/**
 * Insert a booking a 3rd-party API (so far: GetYourGuide — see
 * ota/detect.ts's detectFareharborNotification) already created directly in
 * FareHarbor, built straight from what its own "New Booking" notification
 * email already told us. Deliberately does NOT re-fetch the booking from
 * FareHarbor first: the only endpoint that could do that, getBookings(),
 * 404s against the real API (`/companies/offcourse/bookings/?min_date=...`) —
 * a pre-existing bug, invisible until now because its only other caller
 * (findExistingBooking, in client.ts) silently swallows the error. Worth
 * fixing separately; not a reason to block this feature, since the
 * notification email already carries every field this row needs.
 *
 * booking_uuid is deliberately left null and the FareHarbor pk is stored in
 * `external_id` instead (an otherwise-unused column) — we only have the
 * numeric pk from the email, never FareHarbor's real UUID, and stamping the
 * pk into booking_uuid would make fh-consistency's getBooking(uuid) call
 * 404 and wrongly report this booking as missing from FareHarbor.
 *
 * Money is deliberately left at 0: the guest paid the platform, not us, and
 * that platform's own payout data (src/lib/finance/*-summary.ts) is the
 * right source for the real amount — stamping a number here would just be a
 * second, competing figure Finance would have to reconcile against.
 */
export async function importFareharborBooking(supabase: SupabaseAdmin, booking: ImportableBooking): Promise<ImportBookingResult> {
  if (!booking.dateISO || !booking.time) {
    return { ok: false, error: 'Could not read a clear date/time for this booking from the notification email — check it manually in FareHarbor.' }
  }

  const { data: existing } = await supabase
    .from('bookings')
    .select('id')
    .eq('external_id', String(booking.bookingPk))
    .maybeSingle()
  if (existing) {
    return { ok: false, error: 'This booking is already in our database.' }
  }

  const startTime = amsterdamTimeToUtcIso(booking.dateISO, booking.time)
  const endTime = booking.endTime ? amsterdamTimeToUtcIso(booking.dateISO, booking.endTime) : null

  const { data: inserted, error } = await supabase
    .from('bookings')
    .insert({
      booking_id: `fh_${booking.bookingPk}`,
      external_id: String(booking.bookingPk),
      tour_item_name: booking.experienceName,
      booking_date: booking.dateISO,
      start_time: startTime,
      end_time: endTime,
      guest_count: booking.guests ?? 1,
      customer_name: booking.guestName ?? 'Unknown',
      customer_email: booking.guestEmail ?? '',
      customer_phone: booking.guestPhone,
      status: 'confirmed',
      payment_status: 'paid_externally',
      currency: 'eur',
      booking_source: booking.bookingSource,
      stripe_amount: 0,
      discount_amount_cents: 0,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? 'Could not save the imported booking.' }
  }

  return { ok: true, bookingId: inserted.id, date: booking.dateISO }
}
