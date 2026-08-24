import { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { commissionCentsFor } from '@/lib/scheduling/extra-hours-bonus'

/**
 * POST /api/admin/scheduling/extra-hours-bonus — log an on-the-water upsell
 * (Beer, 2026-08-24: a captain sells extra time on the last tour of the day,
 * 50% commission). commission_cents is computed here, once, from what was
 * actually charged — never re-derived from a rate later, so a future rate
 * change can't reprice a past upsell.
 *
 * DELETE /api/admin/scheduling/extra-hours-bonus?id=... — remove a
 * mis-logged entry. No PATCH: correcting a mistake means delete + re-log,
 * not editing figures in place.
 */
const postSchema = z.object({
  staff_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  extra_minutes: z.number().int().positive(),
  amount_charged_cents: z.number().int().positive(),
  note: z.string().trim().max(500).optional(),
})

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const parsed = postSchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const { staff_id, date, extra_minutes, amount_charged_cents, note } = parsed.data

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('extra_hours_bonuses')
      .insert({
        staff_id,
        date,
        extra_minutes,
        amount_charged_cents,
        commission_cents: commissionCentsFor(amount_charged_cents),
        note: note || null,
      })
      .select('id, staff_id, date, extra_minutes, amount_charged_cents, commission_cents, note')
      .single()
    if (error) return apiError(error.message)

    return apiOk({ bonus: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return apiError('id is required', 400)

    const supabase = createAdminClient()
    const { error } = await supabase.from('extra_hours_bonuses').delete().eq('id', id)
    if (error) return apiError(error.message)

    return apiOk({ id })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
