import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/finance/zettle/months — every stored month, newest first, with
 * the full figure set. Feeds the per-month detail list + the cash-count form in
 * the Zettle tab.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('zettle_monthly_sales')
      .select('*')
      .order('month', { ascending: false })

    if (error) return apiError(error.message)

    const months = (data ?? []).map(m => ({
      id: m.id,
      month: m.month,
      totalInclVatCents: m.total_incl_vat_cents,
      totalExclVatCents: m.total_excl_vat_cents,
      saleCount: m.sale_count,
      vat0Cents: m.vat0_cents,
      vat9ExclCents: m.vat9_excl_cents,
      vat9VatCents: m.vat9_vat_cents,
      vat9InclCents: m.vat9_incl_cents,
      vat21ExclCents: m.vat21_excl_cents,
      vat21VatCents: m.vat21_vat_cents,
      vat21InclCents: m.vat21_incl_cents,
      totalVatCents: m.total_vat_cents,
      cardGrossCents: m.card_gross_cents,
      cardSurchargeCents: m.card_surcharge_cents,
      cardNetCents: m.card_net_cents,
      cashZettleCents: m.cash_zettle_cents,
      cashCountedCents: m.cash_counted_cents,
      notes: m.notes,
    }))

    return apiOk({ months })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
