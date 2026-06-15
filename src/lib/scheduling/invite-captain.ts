import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Invite a staff member as a captain portal user and return their auth user ID.
 *
 * Happy path: calls Supabase's invite-by-email flow, which sends them a login
 * link and creates an auth.users row. The handle_new_user trigger auto-creates
 * user_profiles with role 'guest'; we immediately upgrade it to 'captain'.
 *
 * Idempotent: if the email is already registered (the invite was already sent,
 * or they have an account from another path), we look up the existing profile
 * and ensure their role is 'captain' — no duplicate account, no error thrown.
 *
 * Returns the user_profiles id to write into staff.user_id, or null if the
 * invite + lookup both failed (network error, etc.). Never throws.
 */
export async function inviteCaptain(email: string, name: string): Promise<string | null> {
  try {
    const supabase = createAdminClient()

    const { data: invite, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { display_name: name },
    })

    let userId: string | null = null

    if (!error && invite.user) {
      userId = invite.user.id
    } else if (error) {
      // Email already has an auth account — look it up in user_profiles instead.
      const { data: existing } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle()
      if (existing) userId = existing.id
    }

    if (!userId) return null

    // Ensure their profile is role = captain with the current display name.
    await supabase
      .from('user_profiles')
      .update({ role: 'captain', display_name: name })
      .eq('id', userId)

    return userId
  } catch {
    return null
  }
}
