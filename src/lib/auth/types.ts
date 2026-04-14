export type UserRole = 'admin' | 'support' | 'captain' | 'guest' | 'partner'

export const VALID_ROLES: UserRole[] = ['admin', 'support', 'captain', 'guest', 'partner']

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

// Which roles can access which route groups (path without locale prefix)
export const ROLE_ACCESS: Record<string, UserRole[]> = {
  '/admin':   ['admin'],
  '/captain': ['admin', 'captain'],
  '/support': ['admin', 'support'],
  '/partner': ['admin', 'partner'],
  '/account': ['admin', 'support', 'captain', 'guest', 'partner'],
}

export function canAccessRoute(role: UserRole, pathWithoutLocale: string): boolean {
  for (const [prefix, allowedRoles] of Object.entries(ROLE_ACCESS)) {
    if (pathWithoutLocale === prefix || pathWithoutLocale.startsWith(prefix + '/')) {
      return allowedRoles.includes(role)
    }
  }
  return true // public route
}

export function getDashboardPath(role: UserRole, locale: string): string {
  const dashboards: Record<UserRole, string> = {
    admin:   `/${locale}/admin`,
    captain: `/${locale}/captain`,
    support: `/${locale}/support`,
    partner: `/${locale}/partner`,
    guest:   `/${locale}/account`,
  }
  return dashboards[role]
}
