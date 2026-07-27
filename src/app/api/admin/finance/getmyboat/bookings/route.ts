import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitVat } from '@/lib/finance/withlocals-summary'

const DEFAULT_REVENUE_VAT_RATE = 9

/**
 * GET /api/admin/finance/getmyboat/bookings — every stored booking, newest
 * charter first. Feeds the Getmyboat tab's per-booking list.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('getmyboat_bookings')
      .select('*')
      .order('charter_date', { ascending: false, nullsFirst: false })

    if (error) return apiError(error.message)

    const bookings = (data ?? []).map(b => {
      // Same 9% split the quarter rollup uses (aggregateGetMyBoatSummary) —
      // over the net payout, not the gross "Base Cost" from the confirmation email.
      const net = b.net_amount_cents ?? 0
      const rate = b.revenue_vat_rate ?? DEFAULT_REVENUE_VAT_RATE
      const { exCents, vatCents } = splitVat(net, rate)
      return {
        id: b.id,
        bookingId: b.booking_id,
        guestName: b.guest_name,
        charterDate: b.charter_date,
        netAmountCents: b.net_amount_cents,
        revenueExCents: exCents,
        revenueVatCents: vatCents,
        payoutDate: b.payout_date,
      }
    })

    return apiOk({ bookings })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
