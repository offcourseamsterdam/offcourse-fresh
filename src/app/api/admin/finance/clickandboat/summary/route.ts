import { createSummaryRoute } from '@/lib/api/create-summary-route'
import { aggregateClickAndBoatSummary } from '@/lib/finance/clickandboat-summary'
import type { Database } from '@/lib/supabase/types'

type Row = Pick<
  Database['public']['Tables']['clickandboat_bookings']['Row'],
  'charter_start_date' | 'gross_amount_cents' | 'net_amount_cents' | 'revenue_vat_rate'
>

/** GET /api/admin/finance/clickandboat/summary — quarterly totals, grouped by charter start date. */
export const { GET } = createSummaryRoute({
  table: 'clickandboat_bookings',
  columns: 'charter_start_date, gross_amount_cents, net_amount_cents, revenue_vat_rate',
  map: (b: Row) => ({
    charterStartDate: b.charter_start_date,
    grossAmountCents: b.gross_amount_cents,
    netAmountCents: b.net_amount_cents,
    revenueVatRate: b.revenue_vat_rate,
  }),
  aggregate: aggregateClickAndBoatSummary,
})
