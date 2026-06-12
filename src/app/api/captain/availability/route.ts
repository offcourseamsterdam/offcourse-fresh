import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiOk, apiError } from '@/lib/api/response'
import { requireCaptain } from '@/lib/auth/require-captain'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/captain/availability?from=YYYY-MM-DD&to=YYYY-MM-DD — own rows.
 * PUT /api/captain/availability { date, status } — set one day;
 *     status null clears the day back to "no preference".
 */

const putSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['available', 'prefer_not', 'unavailable']).nullable(),
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
      .select('date, status, note')
      .eq('staff_id', auth.staff.id)
      .gte('date', from)
      .lte('date', to)
    if (error) return apiError(error.message)

    return apiOk({ availability: data })
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

    const { error } = await supabase
      .from('staff_availability')
      .upsert(
        { staff_id: auth.staff.id, date, status },
        { onConflict: 'staff_id,date' },
      )
    if (error) return apiError(error.message)
    return apiOk({ date, status })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
