import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Get the partner_id for API routes.
 *
 * - Admin users: can pass ?pid=<partner_id> to view any partner's data
 * - Partner users: always use their own partner_id from user_profiles
 * - Others: returns null (unauthorized)
 */
export async function getPartnerIdFromRequest(request: NextRequest): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role, partner_id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) return null

  // Admin can view any partner's data via ?pid= query param or oc_admin_pid cookie
  if (profile.role === 'admin') {
    const pid = request.nextUrl.searchParams.get('pid')
      ?? request.cookies.get('oc_admin_pid')?.value
      ?? null
    return pid ?? profile.partner_id ?? null
  }

  // Partner users use their own partner_id
  if (profile.role === 'partner') {
    return profile.partner_id ?? null
  }

  return null
}
