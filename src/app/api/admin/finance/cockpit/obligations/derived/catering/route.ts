import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { estimateCateringSpend, type CateringExtra, type CateringSaleLine } from '@/lib/finance/cockpit/derived/catering-cost'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Same "actually happened" statuses as the city-tax accrual (derived/city-tax.ts):
// a cancelled or unconfirmed booking never bought catering.
const ACTIVE_STATUSES = new Set(['confirmed', 'booked'])

interface ExtrasSelectedLine {
  extra_id?: string
  quantity?: number
}

/**
 * GET /api/admin/finance/cockpit/obligations/derived/catering?from=&to=
 *
 * Informational only — no POST/confirm here. Catering cost is a markup
 * estimate (sell ÷ 1.30), never a stored obligation: real purchase invoices
 * (Phase 4's Finance Inbox) supersede it outright the moment they exist
 * (plan §12c).
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const from = request.nextUrl.searchParams.get('from')
  const to = request.nextUrl.searchParams.get('to')
  if (!from || !DATE_RE.test(from)) return apiError('from is required as YYYY-MM-DD', 400)
  if (!to || !DATE_RE.test(to)) return apiError('to is required as YYYY-MM-DD', 400)

  try {
    const supabase = createAdminClient()

    const { data: bookingRows, error: bookingsErr } = await supabase
      .from('bookings')
      .select('extras_selected, booking_date, status')
      .gte('booking_date', from)
      .lte('booking_date', to)
    if (bookingsErr) return apiError(bookingsErr.message, 500)

    const sales: CateringSaleLine[] = (bookingRows ?? []).flatMap(b => {
      if (!b.status || !ACTIVE_STATUSES.has(b.status) || !b.booking_date) return []
      const items = Array.isArray(b.extras_selected) ? (b.extras_selected as ExtrasSelectedLine[]) : []
      return items.flatMap(item => (item.extra_id ? [{ extraId: item.extra_id, quantity: item.quantity ?? 1, date: b.booking_date as string }] : []))
    })

    const { data: extraRows, error: extrasErr } = await supabase.from('extras').select('id, name, category, price_value')
    if (extrasErr) return apiError(extrasErr.message, 500)
    const extras: CateringExtra[] = (extraRows ?? []).map(e => ({ id: e.id, name: e.name, category: e.category, priceValueCents: e.price_value }))

    const estimate = estimateCateringSpend(extras, sales, { from, to })

    return apiOk({
      estimate,
      note: 'Geschatte inkoopwaarde op basis van verkoopprijs ÷ 1,30 (vaste marge-aanname). Wordt vervangen zodra echte inkoopfacturen beschikbaar zijn.',
    })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/catering GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not estimate catering spend', 500)
  }
}
