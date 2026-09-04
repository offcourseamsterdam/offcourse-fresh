import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postSlackOps } from '@/lib/slack/send-notification'
import { alertCronFailure } from '@/lib/cron/alert'
import { todayISO } from '@/lib/finance/cockpit/dates'
import { formatMissingInvoicesMessage, missingInvoiceCutoff, type MissingInvoiceShift } from '@/lib/finance/invoices/missing'

/**
 * GET /api/cron/finance-missing-invoices — weekly (see vercel.json).
 *
 * §6's missing-invoice insight: a skipper worked a shift more than 14 days
 * ago and never sent an invoice for it (no finance_invoices row has
 * matched_shift_id = that shift). One weekly DM, not a per-shift alert —
 * this is a nudge to chase up a slow skipper, not an incident.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const cutoff = missingInvoiceCutoff(todayISO())

    const { data: shifts, error: shiftsErr } = await supabase
      .from('shifts')
      .select('id, staff_id, boat_id, date')
      .not('staff_id', 'is', null)
      .neq('status', 'cancelled')
      .lt('date', cutoff)
    if (shiftsErr) throw new Error(shiftsErr.message)
    if (!shifts?.length) return NextResponse.json({ ok: true, missingCount: 0, checked: 0 })

    const shiftIds = shifts.map(s => s.id)
    const { data: matched, error: matchedErr } = await supabase
      .from('finance_invoices')
      .select('matched_shift_id')
      .in('matched_shift_id', shiftIds)
    if (matchedErr) throw new Error(matchedErr.message)
    const matchedIds = new Set((matched ?? []).map(m => m.matched_shift_id))

    const missing = shifts.filter(s => !matchedIds.has(s.id))
    if (!missing.length) return NextResponse.json({ ok: true, missingCount: 0, checked: shifts.length })

    const staffIds = [...new Set(missing.map(s => s.staff_id).filter((id): id is string => !!id))]
    const boatIds = [...new Set(missing.map(s => s.boat_id).filter((id): id is string => !!id))]
    const [{ data: staff }, { data: boats }] = await Promise.all([
      staffIds.length ? supabase.from('staff').select('id, name').in('id', staffIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      boatIds.length ? supabase.from('boats').select('id, name').in('id', boatIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ])
    const staffName = new Map((staff ?? []).map(s => [s.id, s.name]))
    const boatName = new Map((boats ?? []).map(b => [b.id, b.name]))

    const rows: MissingInvoiceShift[] = missing.map(s => ({
      id: s.id,
      staffName: (s.staff_id && staffName.get(s.staff_id)) ?? 'Onbekende skipper',
      date: s.date,
      boatName: (s.boat_id && boatName.get(s.boat_id)) ?? null,
    }))

    await postSlackOps(formatMissingInvoicesMessage(rows))

    return NextResponse.json({ ok: true, missingCount: rows.length, checked: shifts.length })
  } catch (err) {
    await alertCronFailure('finance-missing-invoices', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
