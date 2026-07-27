import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitVat } from '@/lib/finance/withlocals-summary'

const DEFAULT_REVENUE_VAT_RATE = 9

/**
 * GET /api/admin/finance/clickandboat/bookings — every stored booking,
 * newest charter first. Feeds the Click & Boat tab's per-booking list.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('clickandboat_bookings')
      .select('*')
      .order('charter_start_date', { ascending: false, nullsFirst: false })

    if (error) return apiError(error.message)

    const bookings = (data ?? []).map(b => {
      // Same 9% split the quarter rollup uses (aggregateClickAndBoatSummary) —
      // over the net amount, not the gross renter total.
      const net = b.net_amount_cents ?? 0
      const rate = b.revenue_vat_rate ?? DEFAULT_REVENUE_VAT_RATE
      const { exCents, vatCents } = splitVat(net, rate)
      return {
        id: b.id,
        charterNumber: b.charter_number,
        listingTitle: b.listing_title,
        charterStartDate: b.charter_start_date,
        charterEndDate: b.charter_end_date,
        durationDays: b.duration_days,
        grossAmountCents: b.gross_amount_cents,
        netAmountCents: b.net_amount_cents,
        revenueExCents: exCents,
        revenueVatCents: vatCents,
        bankTransferDate: b.bank_transfer_date,
        location: b.location,
      }
    })

    return apiOk({ bookings })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
