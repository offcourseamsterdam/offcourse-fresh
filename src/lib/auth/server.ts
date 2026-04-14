import { createClient } from '@/lib/supabase/server'
import type { UserProfile, UserRole } from './types'

export async function getSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data as UserProfile
}

export async function requireRole(allowedRoles: UserRole[]): Promise<UserProfile> {
  const profile = await getUserProfile()
  if (!profile) {
    throw new Error('UNAUTHENTICATED')
  }
  if (!profile.is_active) {
    throw new Error('DEACTIVATED')
  }
  if (!allowedRoles.includes(profile.role)) {
    throw new Error('UNAUTHORIZED')
  }
  return profile
}
