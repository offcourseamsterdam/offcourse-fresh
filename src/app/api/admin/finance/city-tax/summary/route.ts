import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregateCityTaxSummary, CITY_TAX_UNTRACKED_SOURCES, type CityTaxBookingRow } from '@/lib/finance/city-tax'

/**
 * GET /api/admin/finance/city-tax/summary?year=2026
 *
 * Amsterdam's day-trip city tax (€2.60/guest, first 250 guests/year exempt
 * fleet-wide). Reads every `bookings` row for the requested year and hands
 * it to the pure aggregator in `src/lib/finance/city-tax.ts`, which
 * de-duplicates and excludes what it can't trust — see that file for why.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const { searchParams } = new URL(req.url)
    const yearParam = Number(searchParams.get('year'))
    const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : 2026

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('bookings')
      .select('id, booking_uuid, booking_date, guest_count, status, raw_payload')
      .gte('booking_date', `${year}-01-01`)
      .lte('booking_date', `${year}-12-31`)

    if (error) return apiError(error.message)

    const rows: CityTaxBookingRow[] = (data ?? []).map(b => ({
      id: b.id,
      bookingUuid: b.booking_uuid,
      bookingDate: b.booking_date,
      guestCount: b.guest_count,
      status: b.status,
      isShadow: b.raw_payload != null,
    }))

    const summary = aggregateCityTaxSummary(rows, year)

    return apiOk({ ...summary, untrackedSources: CITY_TAX_UNTRACKED_SOURCES })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
