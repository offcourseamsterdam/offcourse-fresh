import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitVat } from '@/lib/finance/withlocals-summary'

const DEFAULT_REVENUE_VAT_RATE = 9
const COMMISSION_VAT_RATE = 21

/**
 * GET /api/admin/finance/barqo/bookings — every stored booking, newest trip
 * first. Feeds the Barqo tab's per-booking list.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('barqo_bookings')
      .select('*')
      .order('trip_date', { ascending: false, nullsFirst: false })

    if (error) return apiError(error.message)

    const bookings = (data ?? []).map(b => {
      // Same split the quarter rollup uses (aggregateBarqoSummary): 9% owed
      // over the NET payout (falls back to gross if unconfirmed), 21%
      // deductible over the gross-minus-net commission gap.
      const gross = b.price_cents ?? 0
      const net = b.net_payout_cents ?? gross
      const rate = b.revenue_vat_rate ?? DEFAULT_REVENUE_VAT_RATE
      const { exCents, vatCents } = splitVat(net, rate)
      const commission = splitVat(Math.max(gross - net, 0), COMMISSION_VAT_RATE)
      return {
        id: b.id,
        bookingNumber: b.booking_number,
        guestName: b.guest_name,
        boatName: b.boat_name,
        tripDate: b.trip_date,
        priceCents: b.price_cents,
        netPayoutCents: b.net_payout_cents,
        revenueExCents: exCents,
        revenueVatCents: vatCents,
        commissionExCents: commission.exCents,
        commissionVatCents: commission.vatCents,
      }
    })

    return apiOk({ bookings })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
