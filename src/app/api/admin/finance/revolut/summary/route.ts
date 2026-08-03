import { createSummaryRoute } from '@/lib/api/create-summary-route'
import { aggregateRevolutSummary } from '@/lib/finance/revolut-summary'
import type { Database } from '@/lib/supabase/types'

type Row = Pick<
  Database['public']['Tables']['revolut_transactions']['Row'],
  'payout_date' | 'original_amount_cents' | 'vat9_gross_cents' | 'vat21_gross_cents'
>

/** GET /api/admin/finance/revolut/summary — quarterly totals, grouped by the verified payout date. */
export const { GET } = createSummaryRoute({
  table: 'revolut_transactions',
  columns: 'payout_date, original_amount_cents, vat9_gross_cents, vat21_gross_cents',
  map: (t: Row) => ({
    payoutDate: t.payout_date,
    originalAmountCents: t.original_amount_cents,
    vat9GrossCents: t.vat9_gross_cents,
    vat21GrossCents: t.vat21_gross_cents,
  }),
  aggregate: aggregateRevolutSummary,
})
