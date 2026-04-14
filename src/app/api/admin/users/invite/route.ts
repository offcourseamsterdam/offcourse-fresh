import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth/server'
import { VALID_ROLES } from '@/lib/auth/types'
import type { UserRole } from '@/lib/auth/types'

// POST /api/admin/users/invite — invite a new user with a specific role (admin only)
export async function POST(request: NextRequest) {
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

  // Create Supabase auth user and send invite email
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name },
  })

  if (authError) {
    return apiError(authError.message)
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

  // Send them a magic link to set up their account
  const { error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (linkError) {
    // Non-fatal — user was created, they can request a link themselves
    console.warn('[invite] Failed to send magic link:', linkError.message)
  }

  return apiOk({ success: true, userId: authData.user.id })
}
