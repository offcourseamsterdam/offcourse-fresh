import { createSummaryRoute } from '@/lib/api/create-summary-route'
import { aggregateGetMyBoatSummary } from '@/lib/finance/getmyboat-summary'
import type { Database } from '@/lib/supabase/types'

type Row = Pick<
  Database['public']['Tables']['getmyboat_bookings']['Row'],
  'charter_date' | 'net_amount_cents' | 'revenue_vat_rate'
>

/** GET /api/admin/finance/getmyboat/summary — quarterly totals, grouped by charter date. */
export const { GET } = createSummaryRoute({
  table: 'getmyboat_bookings',
  columns: 'charter_date, net_amount_cents, revenue_vat_rate',
  map: (b: Row) => ({
    charterDate: b.charter_date,
    netAmountCents: b.net_amount_cents,
    revenueVatRate: b.revenue_vat_rate,
  }),
  aggregate: aggregateGetMyBoatSummary,
})
