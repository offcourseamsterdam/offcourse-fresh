import { createSummaryRoute } from '@/lib/api/create-summary-route'
import { aggregateGetYourGuideSummary } from '@/lib/finance/getyourguide-summary'
import type { Database } from '@/lib/supabase/types'

type Row = Pick<Database['public']['Tables']['getyourguide_payments']['Row'], 'payment_run_date' | 'amount_cents'>

/** GET /api/admin/finance/getyourguide/summary — quarterly totals, grouped by payout date. */
export const { GET } = createSummaryRoute({
  table: 'getyourguide_payments',
  columns: 'payment_run_date, amount_cents',
  map: (p: Row) => ({
    paymentRunDate: p.payment_run_date,
    amountCents: p.amount_cents,
    revenueVatRate: null, // always defaults to 9% — no per-payment override exists (or needed) for this source
  }),
  aggregate: aggregateGetYourGuideSummary,
})
