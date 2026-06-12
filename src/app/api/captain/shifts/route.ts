import { NextRequest, NextResponse } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireCaptain } from '@/lib/auth/require-captain'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/captain/shifts[?from=YYYY-MM-DD&to=YYYY-MM-DD]
 * The captain's own shifts (read-only). Defaults to 2 weeks back → 8 weeks
 * ahead. Cancelled shifts are noise for the crew and are excluded.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCaptain()
  if (auth instanceof NextResponse) return auth

  try {
    const { searchParams } = new URL(request.url)
    const dateRe = /^\d{4}-\d{2}-\d{2}$/
    const fallback = (days: number) => {
      const d = new Date()
      d.setDate(d.getDate() + days)
      return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })
    }
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')
    const from = fromParam && dateRe.test(fromParam) ? fromParam : fallback(-14)
    const to = toParam && dateRe.test(toParam) ? toParam : fallback(56)

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('shifts')
      .select('id, date, start_at, end_at, status, notes, boats(name)')
      .eq('staff_id', auth.staff.id)
      .neq('status', 'cancelled')
      .gte('date', from)
      .lte('date', to)
      .order('start_at')
    if (error) return apiError(error.message)

    return apiOk({ shifts: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
