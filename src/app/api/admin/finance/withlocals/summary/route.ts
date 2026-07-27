import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregateWithlocalsSummary } from '@/lib/finance/withlocals-summary'

/**
 * GET /api/admin/finance/withlocals/summary
 *
 * Per-month Withlocals revenue: gross/ex/9% output VAT on the cruise revenue,
 * 21% input VAT on Withlocals' commission (deductible), net payout, and a
 * per-month per-tour breakdown. Grouped by TRIP month (when the cruise ran),
 * not payout month — that's what "revenue done this month" and "which tours"
 * mean. Only rows with a trip date (i.e. an invoice has been ingested) are
 * counted; payout-only stubs are invisible here until their invoice arrives.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('withlocals_bookings')
      .select('trip_at, tour_name, tour_price_cents, revenue_vat_rate, service_fee_ex_cents, service_fee_vat_cents, net_payout_cents')
      .not('trip_at', 'is', null)

    if (error) return apiError(error.message)

    const bookings = (data ?? []).map(b => ({
      tripAt: b.trip_at,
      tourName: b.tour_name,
      tourPriceCents: b.tour_price_cents,
      revenueVatRate: b.revenue_vat_rate,
      serviceFeeExCents: b.service_fee_ex_cents,
      serviceFeeVatCents: b.service_fee_vat_cents,
      netPayoutCents: b.net_payout_cents,
    }))

    return apiOk(aggregateWithlocalsSummary(bookings))
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
