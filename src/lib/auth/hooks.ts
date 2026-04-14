'use client'

import { useContext } from 'react'
import { AuthContext } from '@/components/auth/AuthProvider'
import type { UserRole } from './types'

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export function useRequireRole(roles: UserRole[]) {
  const { profile, isLoading } = useAuth()
  const isAuthorized = !isLoading && profile !== null && roles.includes(profile.role)
  return { profile, isAuthorized, isLoading }
}
