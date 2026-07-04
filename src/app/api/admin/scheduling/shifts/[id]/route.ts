import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateShiftSchema } from '@/lib/scheduling/shift-schema'
import { notifyShiftAssigned } from '@/lib/scheduling/notify-assignment'
import { emitOpsEvent } from '@/lib/ops/events'

/**
 * PUT    /api/admin/scheduling/shifts/[id] — assign staff / change status,
 *        boat, times, notes. Status follows assignment automatically unless
 *        set explicitly (assign → 'assigned', unassign → 'open').
 * DELETE /api/admin/scheduling/shifts/[id] — manual shifts only; booking
 *        shifts get cancelled by the sync, not deleted (append-only).
 */

type Params = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const parsed = updateShiftSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const body = parsed.data

    const supabase = createAdminClient()
    const { data: existing, error: fetchError } = await supabase
      .from('shifts')
      .select('id, staff_id, status')
      .eq('id', id)
      .single()
    if (fetchError) return apiError(fetchError.message, 404)

    const update: Record<string, unknown> = {}
    if (body.staff_id !== undefined) update.staff_id = body.staff_id
    if (body.boat_id !== undefined) update.boat_id = body.boat_id
    if (body.date !== undefined) update.date = body.date
    if (body.start_at !== undefined) update.start_at = new Date(body.start_at).toISOString()
    if (body.end_at !== undefined) update.end_at = new Date(body.end_at).toISOString()
    if (body.notes !== undefined) update.notes = body.notes

    if (body.status !== undefined) {
      update.status = body.status
    } else if (body.staff_id !== undefined && body.staff_id !== existing.staff_id) {
      // status follows the assignment unless explicitly chosen
      if (body.staff_id && (existing.status === 'open' || existing.status === 'assigned')) {
        update.status = 'assigned'
      }
      if (!body.staff_id && (existing.status === 'assigned' || existing.status === 'confirmed')) {
        update.status = 'open'
      }
    }

    if (Object.keys(update).length === 0) return apiError('Nothing to update', 400)

    const { data, error } = await supabase
      .from('shifts')
      .update(update)
      .eq('id', id)
      .select()
      .single()
    if (error) return apiError(error.message)

    const newlyAssigned = !!body.staff_id && body.staff_id !== existing.staff_id
    const newlyUnassigned = body.staff_id === null && !!existing.staff_id
    if (newlyAssigned) await notifyShiftAssigned(supabase, id)
    if (newlyAssigned || newlyUnassigned) {
      await emitOpsEvent({
        eventType: newlyAssigned ? 'shift_assigned' : 'shift_unassigned',
        actorType: 'human',
        shiftId: id,
        staffId: newlyAssigned ? body.staff_id : existing.staff_id,
        source: 'admin/scheduling/shifts/[id]',
      })
    }

    return apiOk({ shift: data })
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

    const { data: existing, error: fetchError } = await supabase
      .from('shifts')
      .select('id, booking_id, fareharbor_availability_pk')
      .eq('id', id)
      .single()
    if (fetchError) return apiError(fetchError.message, 404)

    if (existing.booking_id || existing.fareharbor_availability_pk != null) {
      return apiError('Booking shifts can’t be deleted — set them to cancelled instead.', 409)
    }

    const { error } = await supabase.from('shifts').delete().eq('id', id)
    if (error) return apiError(error.message)
    return apiOk({ deleted: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
