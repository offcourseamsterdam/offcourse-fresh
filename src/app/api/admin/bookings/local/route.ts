import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * GET /api/admin/bookings/local
 *
 * Returns all bookings stored in our Supabase `bookings` table,
 * ordered most recent first. Every booking made through our checkout
 * flow is saved here automatically.
 */
export async function GET() {
  try {
    const supabase = await createServiceClient()
    const { data, error } = await supabase
      .from('bookings')
      .select('id, created_at, booking_uuid, customer_name, customer_email, customer_phone, tour_item_name, start_time, end_time, booking_date, guest_count, category, listing_title, stripe_payment_intent_id, stripe_amount, status, guest_note, booking_source, deposit_amount_cents, extras_selected, base_amount_cents, extras_amount_cents, base_vat_amount_cents, extras_vat_amount_cents, total_vat_amount_cents')
      .eq('status', 'confirmed')
      .order('booking_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      return apiError(error.message)
    }

    return apiOk(data ?? [])
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
