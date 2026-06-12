import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { staffBodySchema } from '@/lib/scheduling/staff-schema'

/**
 * PUT    /api/admin/scheduling/staff/[id] — update a staff member.
 * DELETE /api/admin/scheduling/staff/[id] — remove one. Blocked by the DB
 *        once shifts/time entries reference them (history is append-only);
 *        deactivate instead in that case.
 */

type Params = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const parsed = staffBodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const body = parsed.data

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('staff')
      .update({
        name: body.name,
        phone: body.phone ?? null,
        email: body.email ?? null,
        role: body.role,
        hourly_rate_cents: body.hourly_rate_cents,
        slack_member_id: body.slack_member_id ?? null,
        is_active: body.is_active ?? true,
        max_shifts_per_week: body.max_shifts_per_week ?? null,
        notes: body.notes ?? null,
        user_id: body.user_id ?? null,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) return apiError(error.message)
    return apiOk({ staff: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { error } = await supabase.from('staff').delete().eq('id', id)

    if (error) {
      // FK violation = they have time entries (payroll history must survive)
      if (error.code === '23503') {
        return apiError('This person has logged hours — deactivate them instead of deleting.', 409)
      }
      return apiError(error.message)
    }
    return apiOk({ deleted: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
