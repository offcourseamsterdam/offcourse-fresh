import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasCatering, cateringAmountCents, filterCateringItems } from '@/lib/catering/filter'

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const [bookingsResult, itemsResult] = await Promise.all([
      supabase
        .from('bookings')
        .select(`
          id, booking_uuid, listing_id, listing_title, tour_item_name,
          customer_name, customer_email, booking_date, start_time,
          guest_count, category, status, booking_source,
          extras_selected, base_amount_cents, extras_amount_cents,
          stripe_amount, deposit_amount_cents, catering_email_sent_at,
          created_at, fareharbor_customer_type_rate_pk, customer_type_name
        `)
        .in('status', ['confirmed', 'booked'])
        .order('booking_date', { ascending: false }),
      supabase
        .from('fareharbor_items')
        .select('customer_types'),
    ])

    if (bookingsResult.error) return apiError(bookingsResult.error.message)

    // Build lookup: rate_pk → name (e.g. "Diana 2h")
    type CtRow = { fareharbor_pk: number; name: string }
    const ctMap = new Map<number, string>()
    for (const item of itemsResult.data ?? []) {
      for (const ct of ((item.customer_types ?? []) as CtRow[])) {
        if (ct.fareharbor_pk && ct.name) ctMap.set(ct.fareharbor_pk, ct.name)
      }
    }

    // Filter to bookings that have at least one food extra
    const cateringBookings = (bookingsResult.data ?? []).filter(b =>
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
        customer_type_name: b.customer_type_name
          ?? (b.fareharbor_customer_type_rate_pk ? (ctMap.get(b.fareharbor_customer_type_rate_pk) ?? null) : null),
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
