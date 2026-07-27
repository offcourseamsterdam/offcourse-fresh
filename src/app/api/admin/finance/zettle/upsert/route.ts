import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/finance/zettle/upsert
 *
 * Save one month of Zettle figures, keyed by `month` (first of the month,
 * "YYYY-MM-01"). Safe to run twice — a month that already exists is updated
 * in place, not duplicated.
 *
 * Only the fields present in the body are written; anything omitted keeps its
 * stored value. That's deliberate: the read-off-the-page sync sends the Zettle
 * figures WITHOUT `cashCountedCents`, so it never wipes Beer's hand-entered
 * cash count — and the cash-count form sends just `{ month, cashCountedCents }`
 * without touching the Zettle figures.
 *
 * Body (JSON): { month: "YYYY-MM-01", ...any subset of the cents fields }
 */

// Maps camelCase body keys → snake_case columns. The single source of truth for
// which fields this route accepts.
const FIELD_MAP: Record<string, string> = {
  totalInclVatCents: 'total_incl_vat_cents',
  totalExclVatCents: 'total_excl_vat_cents',
  saleCount: 'sale_count',
  vat0Cents: 'vat0_cents',
  vat9ExclCents: 'vat9_excl_cents',
  vat9VatCents: 'vat9_vat_cents',
  vat9InclCents: 'vat9_incl_cents',
  vat21ExclCents: 'vat21_excl_cents',
  vat21VatCents: 'vat21_vat_cents',
  vat21InclCents: 'vat21_incl_cents',
  totalVatCents: 'total_vat_cents',
  cardGrossCents: 'card_gross_cents',
  cardSurchargeCents: 'card_surcharge_cents',
  cardNetCents: 'card_net_cents',
  cashZettleCents: 'cash_zettle_cents',
  cashCountedCents: 'cash_counted_cents',
  notes: 'notes',
}

const MONTH_RE = /^\d{4}-\d{2}-01$/

export async function POST(req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Expected a JSON body', 400)

    const month = body.month
    if (typeof month !== 'string' || !MONTH_RE.test(month)) {
      return apiError('month must be the first of a month, formatted "YYYY-MM-01"', 400)
    }

    // Build the column patch from whatever recognised fields were provided.
    const patch: Record<string, unknown> = {}
    for (const [key, column] of Object.entries(FIELD_MAP)) {
      if (!(key in body)) continue
      const value = body[key]
      if (value !== null && key !== 'notes' && typeof value !== 'number') {
        return apiError(`${key} must be a number or null`, 400)
      }
      patch[column] = value
    }

    const supabase = createAdminClient()

    const { data: existing } = await supabase
      .from('zettle_monthly_sales')
      .select('id')
      .eq('month', month)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('zettle_monthly_sales')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) return apiError(error.message)
    } else {
      const { error } = await supabase
        .from('zettle_monthly_sales')
        .insert({ month, ...patch })
      if (error) return apiError(error.message)
    }

    return apiOk({ month, alreadyExisted: !!existing, fieldsWritten: Object.keys(patch).length })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
