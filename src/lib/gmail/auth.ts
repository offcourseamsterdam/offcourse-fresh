// Gmail OAuth2: exchange the long-lived refresh token for a short-lived access
// token. Cached in-module so repeated cron/send calls in the same warm
// serverless instance don't re-fetch. Same no-SDK pattern as
// lib/google-ads/auth.ts — the refresh token was consented separately (see
// scripts/gmail-oauth-setup.ts) for gmail.readonly + gmail.send scopes.
//
// Uses its own dedicated OAuth client (GMAIL_OAUTH_CLIENT_ID/SECRET), not the
// shared GOOGLE_OAUTH_CLIENT_ID Google Ads uses — Gmail push notifications
// require the Pub/Sub topic to live in the same GCP project as the OAuth
// client, and the original shared client turned out to belong to a
// different project than the one hosting this app's infrastructure.

let cached: { token: string; expiresAt: number } | null = null

export async function getGmailAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Gmail OAuth not configured (need GMAIL_OAUTH_CLIENT_ID/SECRET plus GMAIL_REFRESH_TOKEN)',
    )
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Gmail OAuth token refresh failed (${res.status}): ${await res.text()}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}
