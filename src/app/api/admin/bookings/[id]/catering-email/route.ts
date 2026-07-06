import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterCateringItems, type ExtrasLineItem } from '@/lib/catering/filter'
import { buildCateringEmailText } from '@/lib/catering/email-template'
import { buildFHBookingNote } from '@/lib/catering/build-fh-note'
import { sendCateringOrderEmailForBooking } from '@/lib/catering/send-catering-email'

async function fetchBookingForCatering(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_uuid, customer_name, listing_title, tour_item_name,
      booking_date, start_time, guest_count, category,
      extras_selected, catering_email_sent_at, guest_note
    `)
    .eq('id', id)
    .single()
  return { booking: data, error }
}

// ── GET — return the email text for in-admin preview ──────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const { booking, error } = await fetchBookingForCatering(id)
    if (error || !booking) return apiError('Booking not found', 404)

    const cateringItems = filterCateringItems(booking.extras_selected as never)
    if (cateringItems.length === 0) return apiError('No catering items on this booking', 400)

    const text = buildCateringEmailText({
      cruiseName: booking.listing_title ?? booking.tour_item_name ?? 'Cruise',
      dateStr: booking.booking_date,
      timeStr: booking.start_time,
      guestCount: booking.guest_count,
      items: cateringItems,
    })

    const allExtras = (booking.extras_selected ?? []) as unknown as ExtrasLineItem[]
    const fhNote = buildFHBookingNote(booking.guest_note, allExtras)

    return apiOk({ text, alreadySent: !!booking.catering_email_sent_at, fhNote })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

// ── POST — send (or resend) the catering email to the supplier ────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const result = await sendCateringOrderEmailForBooking(id)
    if (!result.ok) return apiError(result.reason, result.reason === 'Booking not found' ? 404 : 400)
    return apiOk({ sent: true, resent: result.resent, recipient: result.recipient })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
