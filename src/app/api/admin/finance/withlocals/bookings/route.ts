import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitVat } from '@/lib/finance/withlocals-summary'

const DEFAULT_REVENUE_VAT_RATE = 9

/**
 * GET /api/admin/finance/withlocals/bookings — every stored booking, newest
 * trip first, with the full field set. Feeds the Withlocals tab's per-booking
 * list and lets the bank-reconciliation view (grouped by payout_date instead
 * of trip month) be built client-side without a second aggregation route.
 *
 * Rows with no trip_at yet (a payout stub whose invoice hasn't arrived) sort
 * last — surfaced separately so Beer can see what's still incomplete.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('withlocals_bookings')
      .select('*')
      .order('trip_at', { ascending: false, nullsFirst: false })

    if (error) return apiError(error.message)

    const bookings = (data ?? []).map(b => {
      // Same 9% split the month/tour rollup uses (aggregateWithlocalsSummary),
      // computed here per booking so the per-tour subtotal can be traced back
      // to the individual invoice numbers/dates that add up to it. The VAT
      // base is the gross tour price on the invoice — accountant-confirmed,
      // NOT the net payout (see withlocals-summary.ts for the full story).
      const gross = b.tour_price_cents ?? 0
      const rate = b.revenue_vat_rate ?? DEFAULT_REVENUE_VAT_RATE
      const { exCents, vatCents } = splitVat(gross, rate)
      return {
        id: b.id,
        bookingId: b.booking_id,
        invoiceNumber: b.invoice_number,
        invoiceDate: b.invoice_date,
        tourName: b.tour_name,
        tripAt: b.trip_at,
        guestCount: b.guest_count,
        guestName: b.guest_name,
        tourPriceCents: b.tour_price_cents,
        revenueExCents: exCents,
        revenueVatCents: vatCents,
        serviceFeeInclCents: b.service_fee_incl_cents,
        serviceFeeVatCents: b.service_fee_vat_cents,
        serviceFeeExCents: b.service_fee_ex_cents,
        netPayoutCents: b.net_payout_cents,
        payoutDate: b.payout_date,
        hasAttachment: !!b.storage_path,
      }
    })

    return apiOk({ bookings })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
