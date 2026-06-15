import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { staffBodySchema, staffBodyToRow } from '@/lib/scheduling/staff-schema'
import { inviteCaptain } from '@/lib/scheduling/invite-captain'

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
      .update(staffBodyToRow(body))
      .eq('id', id)
      .select()
      .single()

    if (error) return apiError(error.message)

    // Auto-invite: if email is now set and no login is linked (either from a
    // previous session or manually chosen in the form), send the invite.
    if (body.email && !data.user_id) {
      const captainUserId = await inviteCaptain(body.email, body.name)
      if (captainUserId) {
        await supabase.from('staff').update({ user_id: captainUserId }).eq('id', id)
        data.user_id = captainUserId
      }
    }

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
