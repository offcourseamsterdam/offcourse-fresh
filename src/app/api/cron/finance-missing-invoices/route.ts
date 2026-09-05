import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postSlackOps } from '@/lib/slack/send-notification'
import { alertCronFailure } from '@/lib/cron/alert'
import { todayISO } from '@/lib/finance/cockpit/dates'
import { findShiftsMissingInvoices, formatMissingInvoicesMessage, type MissingInvoiceShift } from '@/lib/finance/invoices/missing'

/**
 * GET /api/cron/finance-missing-invoices — weekly (see vercel.json).
 *
 * §6's missing-invoice insight: a skipper worked a shift more than 14 days
 * ago and never sent an invoice for it (no finance_invoices row has
 * matched_shift_id = that shift). One weekly DM, not a per-shift alert —
 * this is a nudge to chase up a slow skipper, not an incident.
 *
 * The shift-matching query itself lives in invoices/missing.ts, shared with
 * the dashboard's live "Wat vraagt aandacht?" count — this route's own job
 * is just naming the shifts (staff/boat names) and formatting the DM.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const candidates = await findShiftsMissingInvoices(supabase, todayISO())
    const missing = candidates.filter(s => !s.hasInvoice)
    if (!missing.length) return NextResponse.json({ ok: true, missingCount: 0, checked: candidates.length })

    const staffIds = [...new Set(missing.map(s => s.staffId).filter((id): id is string => !!id))]
    const boatIds = [...new Set(missing.map(s => s.boatId).filter((id): id is string => !!id))]
    const [{ data: staff }, { data: boats }] = await Promise.all([
      staffIds.length ? supabase.from('staff').select('id, name').in('id', staffIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      boatIds.length ? supabase.from('boats').select('id, name').in('id', boatIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ])
    const staffName = new Map((staff ?? []).map(s => [s.id, s.name]))
    const boatName = new Map((boats ?? []).map(b => [b.id, b.name]))

    const rows: MissingInvoiceShift[] = missing.map(s => ({
      id: s.id,
      staffName: (s.staffId && staffName.get(s.staffId)) ?? 'Onbekende skipper',
      date: s.date,
      boatName: (s.boatId && boatName.get(s.boatId)) ?? null,
    }))

    await postSlackOps(formatMissingInvoicesMessage(rows))

    return NextResponse.json({ ok: true, missingCount: rows.length, checked: candidates.length })
  } catch (err) {
    await alertCronFailure('finance-missing-invoices', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
