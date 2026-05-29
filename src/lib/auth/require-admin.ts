import 'server-only'
import type { NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { getUserProfile } from '@/lib/auth/server'

/**
 * Auth guard for /api/admin/** route handlers.
 *
 * Returns a 401/403 NextResponse when the caller is NOT an active admin, or
 * `null` when the caller is authorized (the handler then proceeds).
 *
 * Usage — first line of every admin handler:
 *   const denied = await requireAdmin()
 *   if (denied) return denied
 *
 * Why this exists: admin API routes use the service-role Supabase client, which
 * bypasses RLS. Without this guard those endpoints are reachable unauthenticated
 * (the proxy/middleware deliberately skips /api/, and page-level ProtectedLayout
 * does not protect API routes).
 *
 * Dev bypass: mirrors ProtectedLayout — in development the local admin panel has
 * no real session, so we allow. In production (NODE_ENV=production on Vercel,
 * including preview deploys) the bypass is inactive and real auth is enforced.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === 'development') return null

  const profile = await getUserProfile()
  if (!profile) return apiError('Unauthorized', 401)
  if (!profile.is_active) return apiError('Account deactivated', 403)
  if (profile.role !== 'admin') return apiError('Forbidden', 403)
  return null
}
