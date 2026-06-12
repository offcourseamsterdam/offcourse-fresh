import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { staffBodySchema } from '@/lib/scheduling/staff-schema'

/**
 * GET  /api/admin/scheduling/staff — staff list + captain login profiles
 *      (the modal's "linked login" dropdown needs both at once).
 * POST /api/admin/scheduling/staff — create a staff member.
 */

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const [staffRes, profilesRes] = await Promise.all([
      supabase.from('staff').select('*').order('is_active', { ascending: false }).order('name'),
      supabase
        .from('user_profiles')
        .select('id, display_name, email')
        .eq('role', 'captain')
        .eq('is_active', true)
        .order('display_name'),
    ])

    if (staffRes.error) return apiError(staffRes.error.message)
    if (profilesRes.error) return apiError(profilesRes.error.message)
    return apiOk({ staff: staffRes.data, captainProfiles: profilesRes.data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const parsed = staffBodySchema.safeParse(await request.json())
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid body', 400)
    const body = parsed.data

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('staff')
      .insert({
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
      .select()
      .single()

    if (error) return apiError(error.message)
    return apiOk({ staff: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
