'use client'

import { useAuth } from '@/lib/auth/hooks'
import type { UserRole } from '@/lib/auth/types'

interface Props {
  roles: UserRole[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

/**
 * Renders children only if the current user has one of the specified roles.
 * Use for conditional UI — not a security boundary (that's handled server-side).
 */
export default function RoleGate({ roles, children, fallback = null }: Props) {
  const { profile, isLoading } = useAuth()

  if (isLoading) return null
  if (!profile || !roles.includes(profile.role)) return fallback
  return children
}
