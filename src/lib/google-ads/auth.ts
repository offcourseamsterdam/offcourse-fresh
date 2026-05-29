// Google Ads OAuth2: exchange the long-lived refresh token for a short-lived
// access token. Cached in-module so repeated webhook calls in the same warm
// serverless instance don't re-fetch. No SDK — a single fetch to Google's token
// endpoint keeps the dependency surface (and serverless cold-start cost) minimal.

let cached: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  // The Reviews OAuth client can be reused; fall back to it if Ads-specific
  // creds aren't set separately.
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Ads OAuth not configured (need GOOGLE_ADS_CLIENT_ID/SECRET or GOOGLE_OAUTH_*, plus GOOGLE_ADS_REFRESH_TOKEN)',
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
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${await res.text()}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}
