import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { computeAutoCloseAt } from '@/lib/scheduling/payroll'

/**
 * Auto-close cron — runs nightly. A captain who forgets to check out would
 * otherwise leave an entry open forever (inflating nothing, but never paying
 * either). We close anything still open > 12h after clock-in: at the matched
 * shift's end if known, else capped a few hours past clock-in. Every row we
 * touch is flagged 'auto_closed' so the Payroll tab surfaces it for review —
 * we never silently invent paid hours.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const now = new Date()
  const staleBefore = new Date(now.getTime() - 12 * 3600_000).toISOString()

  const { data: openEntries, error } = await supabase
    .from('time_entries')
    .select('id, clock_in_at, shift_id, shifts(end_at)')
    .is('clock_out_at', null)
    .lt('clock_in_at', staleBefore)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
}
