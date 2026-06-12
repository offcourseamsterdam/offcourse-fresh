import { NextResponse } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireCaptain } from '@/lib/auth/require-captain'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/captain/me — everything the portal Home screen needs:
 * who am I, am I checked in, and what's my next shift.
 */
export async function GET() {
  const auth = await requireCaptain()
  if (auth instanceof NextResponse) return auth
  const { staff } = auth

  try {
    const supabase = createAdminClient()
    const nowIso = new Date().toISOString()

    const [entryRes, nextShiftRes] = await Promise.all([
      supabase
        .from('time_entries')
        .select('id, clock_in_at, shift_id')
        .eq('staff_id', staff.id)
        .is('clock_out_at', null)
        .order('clock_in_at', { ascending: false })
        .limit(1),
      supabase
        .from('shifts')
        .select('id, date, start_at, end_at, status, notes, boats(name)')
        .eq('staff_id', staff.id)
        .in('status', ['assigned', 'confirmed'])
        .gt('end_at', nowIso)
        .order('start_at')
        .limit(1),
    ])
    if (entryRes.error) return apiError(entryRes.error.message)
    if (nextShiftRes.error) return apiError(nextShiftRes.error.message)

    return apiOk({
      staff: { id: staff.id, name: staff.name, role: staff.role },
      openEntry: entryRes.data[0] ?? null,
      nextShift: nextShiftRes.data[0] ?? null,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
