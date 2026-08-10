import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Auth guard for the Gmail Pub/Sub push webhook (/api/webhooks/gmail-push).
 *
 * Google Cloud Pub/Sub push subscriptions can be configured with OIDC auth
 * (a verifiable signed JWT), but that requires fetching and validating
 * against Google's rotating public keys — real complexity for a first cut.
 * Simpler and just as effective here: the push subscription's endpoint URL
 * itself carries a secret token as a query param (`?token=...`), same
 * "fail closed if unconfigured" shape as requireCronSecret. Only Google's
 * Pub/Sub service (and anyone who has the URL) can hit this successfully.
 */
export function requirePubsubSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.GMAIL_PUSH_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (request.nextUrl.searchParams.get('token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
