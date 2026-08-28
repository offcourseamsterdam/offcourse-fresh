import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { withRoute } from '@/lib/api/with-route'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth/server'
import { VALID_ROLES } from '@/lib/auth/types'

// POST /api/admin/users/invite — invite a new user with a specific role (admin only)
export const POST = withRoute(async (request: NextRequest) => {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const body = await request.json()
  const { email, role, display_name } = body

  if (!email || !role) {
    return apiError('email and role are required', 400)
  }

  if (!VALID_ROLES.includes(role)) {
    return apiError('Invalid role', 400)
  }

  const supabase = createAdminClient()

  // inviteUserByEmail both creates the user AND actually dispatches Supabase's
  // real invite email through the project's configured mailer.
  //
  // The previous version here called createUser() + generateLink() instead.
  // generateLink() is explicitly documented as being for a CUSTOM email
  // provider — "Generates email links... to be sent via a custom email
  // provider" — it only mints a link and hands it back; it never sends
  // anything itself. That returned link was never used (the route discarded
  // it after only checking for an error), so this route created a real
  // account, told the admin "Invite sent to {email}", and no email ever went
  // out — silently, every single time. (Found 2026-08-21: Beer invited
  // finance@offcourseamsterdam.com, got the success message, no email arrived.)
  const redirectTo = new URL('/auth/callback?locale=en', request.url).toString()
  const { data: authData, error: authError } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { display_name },
    redirectTo,
  })

  if (authError) {
    return apiError(authError.message)
  }
  if (!authData.user) {
    return apiError('Invite email could not be created')
  }

  // The handle_new_user trigger will have created the profile with role='guest'.
  // Update it to the intended role.
  const { error: profileError } = await supabase
    .from('user_profiles')
    .update({ role, display_name: display_name || null })
    .eq('id', authData.user.id)

  if (profileError) {
    return apiError(profileError.message)
  }

  return apiOk({ success: true, userId: authData.user.id })
})
