import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregateZettleSummary } from '@/lib/finance/zettle-sales'

/** GET /api/admin/finance/zettle/summary — quarterly Zettle totals + cash reconciliation. */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('zettle_monthly_sales')
      .select('month, total_incl_vat_cents, total_vat_cents, vat9_vat_cents, vat21_vat_cents, card_gross_cents, card_surcharge_cents, card_net_cents, cash_zettle_cents, cash_counted_cents')

    if (error) return apiError(error.message)

    const months = (data ?? []).map(m => ({
      month: m.month,
      totalInclVatCents: m.total_incl_vat_cents,
      totalExclVatCents: null,
      saleCount: null,
      vat9ExclCents: null,
      vat9VatCents: m.vat9_vat_cents,
      vat9InclCents: null,
      vat21ExclCents: null,
      vat21VatCents: m.vat21_vat_cents,
      vat21InclCents: null,
      totalVatCents: m.total_vat_cents,
      cardGrossCents: m.card_gross_cents,
      cardSurchargeCents: m.card_surcharge_cents,
      cardNetCents: m.card_net_cents,
      cashZettleCents: m.cash_zettle_cents,
      cashCountedCents: m.cash_counted_cents,
    }))

    return apiOk(aggregateZettleSummary(months))
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
