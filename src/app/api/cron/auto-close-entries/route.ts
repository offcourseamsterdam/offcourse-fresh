import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeAutoCloseAt } from '@/lib/scheduling/payroll'
import { alertCronFailure } from '@/lib/cron/alert'

/**
 * Auto-close cron — runs nightly. A captain who forgets to check out would
 * otherwise leave an entry open forever (inflating nothing, but never paying
 * either). We close anything still open > 12h after clock-in: at the matched
 * shift's end if known, else capped a few hours past clock-in. Every row we
 * touch is flagged 'auto_closed' so the Payroll tab surfaces it for review —
 * we never silently invent paid hours.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req)
  if (denied) return denied

  try {
    const supabase = createAdminClient()

    const now = new Date()
    const staleBefore = new Date(now.getTime() - 12 * 3600_000).toISOString()

    const { data: openEntries, error } = await supabase
      .from('time_entries')
      .select('id, clock_in_at, shift_id, shifts(end_at)')
      .is('clock_out_at', null)
      .lt('clock_in_at', staleBefore)
    if (error) throw new Error(`query open entries: ${error.message}`)
    if (!openEntries?.length) return NextResponse.json({ closed: 0 })

    let closed = 0
    for (const entry of openEntries) {
      const shiftEnd = (entry.shifts as { end_at: string } | null)?.end_at ?? null
      const closeAt = computeAutoCloseAt(entry.clock_in_at, shiftEnd)
      const { error: updErr } = await supabase
        .from('time_entries')
        .update({ clock_out_at: closeAt, flag: 'auto_closed' })
        .eq('id', entry.id)
      if (!updErr) closed++
    }

    return NextResponse.json({ closed })
  } catch (err) {
    // Unattended nightly job — a silent failure leaves time entries open and
    // payroll wrong with nobody watching. Page Slack.
    await alertCronFailure('auto-close-entries', err)
    return NextResponse.json({ error: 'Auto-close failed' }, { status: 500 })
  }
}
