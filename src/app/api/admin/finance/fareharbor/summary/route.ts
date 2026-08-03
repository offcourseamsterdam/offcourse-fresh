import { createSummaryRoute } from '@/lib/api/create-summary-route'
import { aggregateFareHarborPayoutSummary } from '@/lib/finance/fareharbor-payout-summary'
import type { Database } from '@/lib/supabase/types'

type Row = Pick<
  Database['public']['Tables']['fareharbor_payouts']['Row'],
  'bank_payout_date' | 'gross_cents' | 'net_cents' | 'vat9_cents' | 'vat21_cents'
>

/** GET /api/admin/finance/fareharbor/summary — quarterly totals, grouped by the verified bank payout date. */
export const { GET } = createSummaryRoute({
  table: 'fareharbor_payouts',
  columns: 'bank_payout_date, gross_cents, net_cents, vat9_cents, vat21_cents',
  map: (p: Row) => ({
    bankPayoutDate: p.bank_payout_date,
    grossCents: p.gross_cents,
    netCents: p.net_cents,
    vat9Cents: p.vat9_cents,
    vat21Cents: p.vat21_cents,
  }),
  aggregate: aggregateFareHarborPayoutSummary,
})
