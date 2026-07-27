import 'server-only'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Temporary accountant access to /api/admin/finance/** ONLY, without a real
 * admin login. See finance_share_links migration (107) and the "Share with
 * accountant" panel on FinancePage. Every other /api/admin/** route still
 * requires requireAdmin() unchanged — this guard is scoped to finance routes
 * by which routes call it, not by anything in the token itself.
 */
export const FINANCE_SHARE_COOKIE = 'fs_token'

export async function requireAdminOrFinanceShare(): Promise<NextResponse | null> {
  const adminDenied = await requireAdmin()
  if (!adminDenied) return null

  const jar = await cookies()
  const token = jar.get(FINANCE_SHARE_COOKIE)?.value
  if (!token) return adminDenied

  const valid = await isValidFinanceShareToken(token)
  return valid ? null : adminDenied
}

export async function isValidFinanceShareToken(token: string): Promise<boolean> {
  if (!token) return false
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('finance_share_links')
    .select('id')
    .eq('token', token)
    .is('revoked_at', null)
    .maybeSingle()
  return !!data
}

export function generateFinanceShareToken(): string {
  return randomBytes(32).toString('hex')
}
