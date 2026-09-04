'use client'

import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { BoatOption } from './api-types'

/**
 * The boat picker's options (Diana, Curaçao). Reuses the listing editor's
 * /api/admin/boats route (which wraps its rows as `{ data: [...] }`);
 * returns [] until loaded so selects render immediately.
 */
export function useBoats(enabled = true): BoatOption[] {
  const { data } = useAdminFetch<{ data: Array<{ id: string; name: string }> }>(enabled ? '/api/admin/boats' : null)
  return data?.data ?? []
}

export function boatName(boats: BoatOption[], id: string | null | undefined): string | null {
  if (!id) return null
  return boats.find(b => b.id === id)?.name ?? null
}
