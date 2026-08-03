import { createSummaryRoute } from '@/lib/api/create-summary-route'
import { aggregateBarqoSummary } from '@/lib/finance/barqo-summary'
import type { Database } from '@/lib/supabase/types'

type Row = Pick<
  Database['public']['Tables']['barqo_bookings']['Row'],
  'trip_date' | 'price_cents' | 'net_payout_cents' | 'revenue_vat_rate'
>

/** GET /api/admin/finance/barqo/summary — quarterly totals, grouped by trip date. */
export const { GET } = createSummaryRoute({
  table: 'barqo_bookings',
  columns: 'trip_date, price_cents, net_payout_cents, revenue_vat_rate',
  map: (b: Row) => ({
    tripDate: b.trip_date,
    priceCents: b.price_cents,
    netPayoutCents: b.net_payout_cents,
    revenueVatRate: b.revenue_vat_rate,
  }),
  aggregate: aggregateBarqoSummary,
})
