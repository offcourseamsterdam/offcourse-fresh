import type { UserRole, UserProfile } from '@/lib/auth/types'

interface Props {
  allowedRoles: UserRole[]
  locale: string
  children: (profile: UserProfile) => React.ReactNode
}

/**
 * Server component wrapper for protected route layouts.
 * Fetches the current user's profile, checks role, and either renders
 * children (passing profile) or redirects to login/error page.
 */
const DEV_PROFILE: UserProfile = {
  id: 'dev',
  email: 'dev@offcourseamsterdam.com',
  display_name: 'Dev (Beer)',
  role: 'admin',
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export default async function ProtectedLayout({ allowedRoles: _allowedRoles, locale: _locale, children }: Props) {
  // Auth is currently disabled — /admin is accessible without login.
  // Re-enable the profile fetch + redirect block below before going to production.
  return <>{children(DEV_PROFILE)}</>
}
