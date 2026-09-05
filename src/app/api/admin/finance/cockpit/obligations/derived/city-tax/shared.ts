/**
 * Shared loader for the city-tax derived-obligation route (GET/POST) and the
 * nightly auto-sync cron. Not a route file itself — Next.js only treats
 * `route.ts` as an endpoint, so this plain module lives alongside it safely
 * (a route.ts may only export recognized HTTP-method/config names).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { CityTaxBooking } from '@/lib/finance/cockpit/derived/city-tax'

type Admin = SupabaseClient<Database>

export async function loadBookingsForYear(supabase: Admin, year: number): Promise<CityTaxBooking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, booking_uuid, booking_date, guest_count, status, booking_source')
    .gte('booking_date', `${year}-01-01`)
    .lte('booking_date', `${year}-12-31`)
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => ({
    id: r.id,
    bookingUuid: r.booking_uuid,
    bookingDate: r.booking_date,
    guestCount: r.guest_count,
    status: r.status,
    bookingSource: r.booking_source,
  }))
}
