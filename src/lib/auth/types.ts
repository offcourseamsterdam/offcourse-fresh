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
