import { createSummaryRoute } from '@/lib/api/create-summary-route'
import { aggregateViatorSummary } from '@/lib/finance/viator-summary'
import type { Database } from '@/lib/supabase/types'

type Row = Pick<Database['public']['Tables']['viator_payment_batches']['Row'], 'advice_date' | 'total_amount_cents'> & {
  viator_payment_lines: { count: number }[] | null
}

/**
 * GET /api/admin/finance/viator/summary
 *
 * Quarterly totals from stored Viator payment advices. See
 * aggregateViatorSummary for the bucketing rules (grouped by the advice/
 * payout date, same convention as the Stripe VAT summary).
 */
export const { GET } = createSummaryRoute({
  table: 'viator_payment_batches',
  columns: 'advice_date, total_amount_cents, viator_payment_lines(count)',
  map: (b: Row) => ({
    adviceDate: b.advice_date,
    totalAmountCents: b.total_amount_cents,
    lineCount: b.viator_payment_lines?.[0]?.count ?? 0,
    revenueVatRate: null, // always defaults to 9% — no per-batch override exists (or needed) for this source
  }),
  aggregate: aggregateViatorSummary,
})
