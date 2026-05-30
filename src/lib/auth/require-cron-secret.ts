import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Auth guard for Vercel Cron job routes (/api/cron/**).
 *
 * Usage — first line of each cron handler:
 *   const denied = requireCronSecret(request)
 *   if (denied) return denied
 *
 * Why a dedicated helper (not requireAdmin):
 * Vercel Cron sends requests with a Bearer token from the CRON_SECRET env var, not
 * with a user session cookie. Admin auth would reject them unconditionally.
 *
 * Why not `authHeader !== \`Bearer ${process.env.CRON_SECRET}\``:
 * When CRON_SECRET is absent, process.env.CRON_SECRET is undefined, and the template
 * literal produces the string "Bearer undefined". Any caller who sends
 * `Authorization: Bearer undefined` would bypass the check — a predictable bypass
 * on any deployment where the env var is missing. This helper fails closed instead:
 * if the secret is not configured, ALL requests are rejected.
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Fail closed — never authorize when the secret is not configured.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
