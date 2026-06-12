import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/auth/server'
import { getDashboardPath } from '@/lib/auth/types'
import type { UserRole, UserProfile } from '@/lib/auth/types'

interface Props {
  allowedRoles: UserRole[]
  locale: string
  children: (profile: UserProfile) => React.ReactNode
}

const DEV_PROFILE: UserProfile = {
  id: 'dev',
  email: 'dev@offcourseamsterdam.com',
  display_name: 'Dev (Beer)',
  role: 'admin',
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export default async function ProtectedLayout({ allowedRoles, locale, children }: Props) {
  // Skip auth ONLY when explicitly opted in via env var AND running a dev build.
  // The double condition means a preview/staging deploy can never expose the
  // admin by accident: Vercel builds run NODE_ENV=production, and the env var
  // is never set in any deployed environment — only in a local .env.local.
  if (process.env.ADMIN_DEV_BYPASS === 'true' && process.env.NODE_ENV === 'development') {
    return <>{children(DEV_PROFILE)}</>
  }

  let profile: UserProfile | null = null

  try {
    profile = await getUserProfile()
  } catch (err) {
    console.warn('[ProtectedLayout] Failed to fetch profile:', err)
  }

  if (!profile) {
    redirect(`/${locale}/login`)
  }

  if (!profile.is_active) {
    redirect(`/${locale}/login?error=deactivated`)
  }

  if (!allowedRoles.includes(profile.role)) {
    redirect(getDashboardPath(profile.role, locale))
  }

  return <>{children(profile)}</>
}
