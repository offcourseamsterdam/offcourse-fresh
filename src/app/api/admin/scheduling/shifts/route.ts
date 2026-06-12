import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { manualShiftSchema } from '@/lib/scheduling/shift-schema'
import { notifyShiftAssigned } from '@/lib/scheduling/notify-assignment'

/**
 * GET  /api/admin/scheduling/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD
 *      Everything the week grid needs in one call: shifts, boats, active
 *      staff, and the staff availability rows for the range.
 * POST /api/admin/scheduling/shifts — manual shift (maintenance day,
 *      charter hold, or pre-adding capacity for an expected-busy day).
 */

export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return apiError('from and to (YYYY-MM-DD) are required', 400)
    }

    const supabase = createAdminClient()
    const [shiftsRes, boatsRes, staffRes, availabilityRes] = await Promise.all([
      supabase
        .from('shifts')
        .select('*, staff(name), bookings(customer_name, guest_count, category, listing_title)')
        .gte('date', from)
        .lte('date', to)
        .order('start_at'),
      supabase.from('boats').select('id, name').eq('is_active', true).order('display_order'),
      supabase
        .from('staff')
        .select('id, name, role, max_shifts_per_week')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('staff_availability')
        .select('staff_id, date, status')
        .gte('date', from)
        .lte('date', to),
    ])
    if (shiftsRes.error) return apiError(shiftsRes.error.message)
    if (boatsRes.error) return apiError(boatsRes.error.message)
    if (staffRes.error) return apiError(staffRes.error.message)
    if (availabilityRes.error) return apiError(availabilityRes.error.message)

    return apiOk({
      shifts: shiftsRes.data,
      boats: boatsRes.data,
      staff: staffRes.data,
      availability: availabilityRes.data,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const parsed = manualShiftSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const body = parsed.data
    if (Date.parse(body.end_at) <= Date.parse(body.start_at)) {
      return apiError('End must be after start', 400)
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('shifts')
      .insert({
        date: body.date,
        start_at: new Date(body.start_at).toISOString(),
        end_at: new Date(body.end_at).toISOString(),
        boat_id: body.boat_id,
        staff_id: body.staff_id ?? null,
        notes: body.notes ?? null,
        status: body.staff_id ? 'assigned' : 'open',
      })
      .select()
      .single()

    if (error) return apiError(error.message)
    if (data.staff_id) await notifyShiftAssigned(supabase, data.id)
    return apiOk({ shift: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
