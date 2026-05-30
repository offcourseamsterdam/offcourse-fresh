import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTiers } from '@/lib/cancellation/policy'

/**
 * PATCH /api/admin/fareharbor-items/[id]
 * Body: { booking_cutoff_hours?: number|null, max_slot_capacity?: number|null,
 *         cancellation_tiers?: CancellationTier[] }
 *
 * Updates the editable settings for one FareHarbor item. Each setting applies to
 * every virtual cruise listing linked to that item. Only the three whitelisted
 * fields can be written here — never arbitrary columns.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const update: Record<string, unknown> = {}

  if ('booking_cutoff_hours' in body) {
    const v = body.booking_cutoff_hours
    if (v === null) {
      update.booking_cutoff_hours = null
    } else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return apiError('booking_cutoff_hours must be a non-negative number or null', 400)
      update.booking_cutoff_hours = n
    }
  }

  if ('max_slot_capacity' in body) {
    const v = body.max_slot_capacity
    if (v === null) {
      update.max_slot_capacity = null
    } else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 1) return apiError('max_slot_capacity must be a positive number or null', 400)
      update.max_slot_capacity = n
    }
  }

  if ('cancellation_tiers' in body) {
    update.cancellation_tiers = normalizeTiers(body.cancellation_tiers)
  }

  if (Object.keys(update).length === 0) {
    return apiError('No updatable fields provided', 400)
  }

  const supabase = createAdminClient()
  // `update` holds only whitelisted columns; cast through never for the typed Update.
  const { error } = await supabase
    .from('fareharbor_items')
    .update(update as never)
    .eq('id', id)

  if (error) return apiError(error.message)
  return apiOk({})
}
