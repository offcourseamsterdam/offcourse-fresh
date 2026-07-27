import { createSummaryRoute } from '@/lib/api/create-summary-route'
import { aggregateBoatLocalSummary } from '@/lib/finance/boatlocal-summary'
import type { Database } from '@/lib/supabase/types'

type Row = Pick<
  Database['public']['Tables']['boatlocal_payout_batches']['Row'],
  'issue_date' | 'operator_payout_cents' | 'vat_9_in_payout_cents' | 'vat_21_cents'
> & {
  boatlocal_payout_lines: { count: number }[] | null
}

/** GET /api/admin/finance/boatlocal/summary — quarterly totals, grouped by payout date. */
export const { GET } = createSummaryRoute({
  table: 'boatlocal_payout_batches',
  columns: 'issue_date, operator_payout_cents, vat_9_in_payout_cents, vat_21_cents, boatlocal_payout_lines(count)',
  map: (b: Row) => ({
    issueDate: b.issue_date,
    operatorPayoutCents: b.operator_payout_cents,
    vat9InPayoutCents: b.vat_9_in_payout_cents,
    vat21Cents: b.vat_21_cents,
    lineCount: b.boatlocal_payout_lines?.[0]?.count ?? 0,
  }),
  aggregate: aggregateBoatLocalSummary,
})
