import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserProfile } from './types'

interface ResolveResult {
  profile: UserProfile | null
  error: 'no_profile' | 'deactivated' | null
}

/**
 * Look up or auto-create a user profile after auth.
 *
 * Uses an admin Supabase client (service role key, bypasses RLS) so the
 * read always works regardless of the caller's auth state.
 *
 * - If a profile exists and is active → returns it.
 * - If no profile exists → auto-creates a guest profile.
 * - If the profile is deactivated → returns a 'deactivated' error.
 * - If creation fails → returns a 'no_profile' error.
 */
export async function resolveProfile(
  admin: SupabaseClient,
  user: { id: string; email?: string },
): Promise<ResolveResult> {
  // 1. Try to read existing profile
  const { data: profile } = await admin
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profile) {
    const typed = profile as UserProfile
    if (!typed.is_active) {
      return { profile: null, error: 'deactivated' }
    }
    return { profile: typed, error: null }
  }

  // 2. Auto-create guest profile for new users
  const { data: newProfile, error: insertError } = await admin
    .from('user_profiles')
    .insert({
      id: user.id,
      email: user.email ?? '',
      role: 'guest',
      is_active: true,
    })
    .select('*')
    .single()

  if (insertError || !newProfile) {
    return { profile: null, error: 'no_profile' }
  }

  return { profile: newProfile as UserProfile, error: null }
}
