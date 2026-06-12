import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildShiftIcs, type IcsShift } from '@/lib/scheduling/ics'

/**
 * GET /api/calendar/[token].ics
 *
 * Public iCalendar feed of one captain's shifts. Secured by the unguessable
 * per-staff calendar_token (a UUID) — calendar apps can't carry a login
 * session, so the secret lives in the URL. We expose only future + recent
 * shifts and never any pay/PII beyond the boat name.
 *
 * Lives OUTSIDE /api/admin and /api/captain on purpose: no session guard,
 * just the token.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token: rawToken } = await params
  // Tolerate a ".ics" suffix so subscribe URLs can look like calendars.
  const token = rawToken.replace(/\.ics$/i, '')

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const supabase = createAdminClient()

  const { data: staff } = await supabase
    .from('staff')
    .select('id, name')
    .eq('calendar_token', token)
    .single()
  if (!staff) return new NextResponse('Not found', { status: 404 })

  // Two weeks back through eight weeks ahead — same window the portal shows.
  const now = new Date()
  const from = new Date(now.getTime() - 14 * 86400_000).toISOString()
  const to = new Date(now.getTime() + 56 * 86400_000).toISOString()

  const { data: shifts } = await supabase
    .from('shifts')
    .select('id, start_at, end_at, status, notes, boats(name)')
    .eq('staff_id', staff.id)
    .neq('status', 'cancelled')
    .gte('start_at', from)
    .lte('start_at', to)
    .order('start_at', { ascending: true })

  const icsShifts: IcsShift[] = (shifts ?? []).map(s => ({
    id: s.id,
    start_at: s.start_at,
    end_at: s.end_at,
    status: s.status,
    notes: s.notes,
    boatName: (s.boats as { name: string } | null)?.name ?? null,
  }))

  const body = buildShiftIcs(icsShifts, {
    calendarName: `${staff.name} — Off Course shifts`,
    stamp: now.toISOString(),
  })

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
