import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminDevBypassEnabled } from '@/lib/auth/dev-bypass'
import { apiOk, apiError } from '@/lib/api/response'

/**
 * POST /api/dev/admin-bypass
 *
 * Dev-only shortcut: signs the caller in as the configured admin account
 * without a login step, by generating a Supabase magic-link token
 * server-side (service role) and immediately verifying it into a real
 * session (same cookies a normal login produces). Gated by
 * isAdminDevBypassEnabled() — disabled entirely wherever the env vars it
 * checks aren't set, which must never include Vercel's Production scope.
 *
 * Returns 404 when disabled so the route doesn't announce its own existence.
 */
export async function POST() {
  if (!isAdminDevBypassEnabled()) {
    return apiError('Not found', 404)
  }

  const email = process.env.ADMIN_DEV_BYPASS_EMAIL!
  const admin = createAdminClient()

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  const hashedToken = linkData?.properties?.hashed_token
  if (linkError || !hashedToken) {
    return apiError(linkError?.message ?? 'Failed to generate login link')
  }

  const supabase = await createClient()
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: hashedToken,
  })

  if (verifyError) {
    return apiError(verifyError.message, 401)
  }

  return apiOk({ signedInAs: email })
}
