import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { buildAuthorizeUrl } from '@/lib/revolut/auth'
import { getRevolutEnvConfig } from '@/lib/revolut/token-store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/revolut/connect
 * Returns the Revolut consent URL. No side effects: the admin opens it, approves
 * with 2FA in Revolut, and Revolut redirects to ../callback with a code.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const env = getRevolutEnvConfig()
  if (!env) return apiError('Revolut is niet geconfigureerd: zet REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY (en NEXT_PUBLIC_SITE_URL of REVOLUT_REDIRECT_URI).', 400)
  if (!process.env.REVOLUT_TOKEN_KEY) return apiError('REVOLUT_TOKEN_KEY ontbreekt; tokens kunnen niet versleuteld worden opgeslagen.', 400)
  return apiOk({
    authorizeUrl: buildAuthorizeUrl({ environment: env.environment, clientId: env.clientId, redirectUri: env.redirectUri, scopes: env.scopes }),
    environment: env.environment,
    redirectUri: env.redirectUri,
    scopes: env.scopes,
  })
}
