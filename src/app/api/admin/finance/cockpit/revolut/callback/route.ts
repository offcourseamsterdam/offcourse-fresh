import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { completeConsent, createRevolutClient, getRevolutEnvConfig } from '@/lib/revolut/token-store'
import { syncRevolut } from '@/lib/revolut/sync'
import { redact } from '@/lib/revolut/auth'

export const dynamic = 'force-dynamic'

const OVERVIEW = '/admin/finance/overview'

/**
 * GET /api/admin/finance/cockpit/revolut/callback?code=…
 * Revolut sends the admin back here after consent. The code is valid for two
 * minutes, so we exchange it immediately, store the tokens encrypted, run a
 * first sync, and bounce back to the dashboard. The admin session cookie is
 * still present (same browser), so requireAdmin() holds here too.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const back = (q: string) => NextResponse.redirect(new URL(`${OVERVIEW}?${q}`, url.origin))

  if (error || !code) return back(`revolut=error&reason=${encodeURIComponent(error ?? 'no_code')}`)

  const env = getRevolutEnvConfig()
  if (!env) return back('revolut=error&reason=not_configured')

  try {
    const supabase = createAdminClient()
    await completeConsent(supabase, code, env)
    const client = await createRevolutClient(supabase, env)
    const sync = await syncRevolut(supabase, client)
    return back(sync.ok ? 'revolut=connected' : `revolut=connected&sync=failed`)
  } catch (err) {
    console.error('[revolut/callback]', redact((err as Error).message))
    return back(`revolut=error&reason=${encodeURIComponent(redact((err as Error).message).slice(0, 120))}`)
  }
}
