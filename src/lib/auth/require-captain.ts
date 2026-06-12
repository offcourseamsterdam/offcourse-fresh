import 'server-only'
import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { getUserProfile } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

export type StaffRecord = Database['public']['Tables']['staff']['Row']

export type CaptainAuth = { staff: StaffRecord }

/**
 * Auth guard for /api/captain/** route handlers.
 *
 * A valid caller is a logged-in, active profile with role captain (or admin,
 * so Beer can preview the portal) AND a linked staff record
 * (staff.user_id = profile.id). Returns the staff record on success so
 * handlers never re-resolve it; returns a NextResponse to bounce otherwise.
 *
 * Usage:
 *   const auth = await requireCaptain()
 *   if (auth instanceof NextResponse) return auth
 *   const { staff } = auth
 *
 * NOTE: the admin route contract test does NOT cover /api/captain/** —
 * every handler must call this explicitly.
 *
 * The 403 for a logged-in captain without a staff record uses the literal
 * 'unlinked' error so the portal UI can show its "ask the admin to link
 * your account" state instead of a generic error.
 *
 * Dev bypass: mirrors requireAdmin — local dev has no real session, so we
 * impersonate the first active staff member that has a linked login (or any
 * active staff as fallback) to make the portal testable.
 */
export async function requireCaptain(): Promise<CaptainAuth | NextResponse> {
  const supabase = createAdminClient()

  if (process.env.NODE_ENV === 'development') {
    const { data } = await supabase
      .from('staff')
      .select('*')
      .eq('is_active', true)
      .order('user_id', { ascending: false, nullsFirst: false })
      .order('created_at')
      .limit(1)
    if (data?.[0]) return { staff: data[0] }
    return apiError('unlinked', 403)
  }

  const profile = await getUserProfile()
  if (!profile) return apiError('Unauthorized', 401)
  if (!profile.is_active) return apiError('Account deactivated', 403)
  if (profile.role !== 'captain' && profile.role !== 'admin') return apiError('Forbidden', 403)

  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .eq('user_id', profile.id)
    .eq('is_active', true)
    .limit(1)
  if (error) return apiError(error.message)
  if (!data?.[0]) return apiError('unlinked', 403)

  return { staff: data[0] }
}
