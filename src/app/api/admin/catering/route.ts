import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasCatering, cateringAmountCents, filterCateringItems } from '@/lib/catering/filter'

export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('bookings')
      .select(`
        id, booking_uuid, listing_id, listing_title, tour_item_name,
        customer_name, customer_email, booking_date, start_time,
        guest_count, category, status, booking_source,
        extras_selected, base_amount_cents, extras_amount_cents,
        stripe_amount, deposit_amount_cents, catering_email_sent_at,
        created_at
      `)
      .in('status', ['confirmed', 'booked'])
      .order('booking_date', { ascending: false })

    if (error) return apiError(error.message)

    // Filter to bookings that have at least one food/drinks extra
    // Dataset is small so JS filtering is fine
    const cateringBookings = (data ?? []).filter(b =>
      hasCatering(b.extras_selected as never)
    )

    const totalRevenueCents = cateringBookings.reduce(
      (sum, b) => sum + cateringAmountCents(b.extras_selected as never),
      0,
    )
    const pendingCount = cateringBookings.filter(b => !b.catering_email_sent_at).length

    return apiOk({
      bookings: cateringBookings.map(b => ({
        ...b,
        cateringItems: filterCateringItems(b.extras_selected as never),
        cateringAmountCents: cateringAmountCents(b.extras_selected as never),
      })),
      stats: {
        totalRevenueCents,
        bookingCount: cateringBookings.length,
        pendingCount,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
