import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiOk, apiError } from '@/lib/api/response'
import { requireCaptain } from '@/lib/auth/require-captain'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/captain/availability?from=YYYY-MM-DD&to=YYYY-MM-DD — own rows.
 * PUT /api/captain/availability { date, status, startTime?, endTime? } —
 *     set one day; status null clears the day back to "no preference".
 *
 * startTime/endTime (Beer, 2026-08-23: "available between these and these
 * times") are OPTIONAL and only meaningful on 'available' — both null/omitted
 * means "all day", the unchanged default; set, they mean "partly available"
 * (Beer, same day: "available, or partly available"). 'unavailable' and
 * clearing (status: null) always force them to null: there's no partial-day
 * window to speak of when the day itself is off or unset.
 */

// Real HH:MM only (00-23 / 00-59) — a plain \d{2}:\d{2} would let "25:99"
// through Zod and fail later as a raw Postgres error instead of a clean 400.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const putSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['available', 'unavailable']).nullable(),
    startTime: z.string().regex(TIME_RE).nullable().optional(),
    endTime: z.string().regex(TIME_RE).nullable().optional(),
  })
  .refine(v => !!v.startTime === !!v.endTime, {
    message: 'startTime and endTime must be given together, or not at all',
  })
  .refine(v => !v.startTime || !v.endTime || v.endTime > v.startTime, {
    message: 'endTime must be after startTime',
  })

export async function GET(request: NextRequest) {
  const auth = await requireCaptain()
  if (auth instanceof NextResponse) return auth

  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return apiError('from and to (YYYY-MM-DD) are required', 400)
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('staff_availability')
      .select('date, status, start_time, end_time')
      .eq('staff_id', auth.staff.id)
      .gte('date', from)
      .lte('date', to)
    if (error) return apiError(error.message)

    return apiOk({
      availability: (data ?? []).map(row => ({
        date: row.date,
        status: row.status,
        // Postgres TIME comes back as "HH:MM:SS" — trim to "HH:MM" to match
        // what <input type="time"> and this API's own PUT body expect.
        startTime: row.start_time?.slice(0, 5) ?? null,
        endTime: row.end_time?.slice(0, 5) ?? null,
      })),
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireCaptain()
  if (auth instanceof NextResponse) return auth

  try {
    const parsed = putSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const { date, status } = parsed.data

    const supabase = createAdminClient()
    if (status === null) {
      const { error } = await supabase
        .from('staff_availability')
        .delete()
        .eq('staff_id', auth.staff.id)
        .eq('date', date)
      if (error) return apiError(error.message)
      return apiOk({ date, status: null })
    }

    // 'unavailable' never carries a time window — the whole day is out.
    const startTime = status === 'unavailable' ? null : (parsed.data.startTime ?? null)
    const endTime = status === 'unavailable' ? null : (parsed.data.endTime ?? null)

    const { error } = await supabase
      .from('staff_availability')
      .upsert(
        { staff_id: auth.staff.id, date, status, start_time: startTime, end_time: endTime },
        { onConflict: 'staff_id,date' },
      )
    if (error) return apiError(error.message)
    return apiOk({ date, status, startTime, endTime })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
