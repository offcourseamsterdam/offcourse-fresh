/**
 * Google OAuth 2.0 utilities for the Business Profile API.
 *
 * The Business Profile API requires OAuth (not just an API key) because
 * Google needs to verify the replier is the actual business owner/manager.
 * Beer authorizes once, and we store + auto-refresh the tokens.
 */

import { createAdminClient } from '@/lib/supabase/admin'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/business.manage'

function getClientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!id) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not set')
  return id
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!secret) throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is not set')
  return secret
}

export function getRedirectUri(origin?: string): string {
  const siteUrl = origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return `${siteUrl}/api/admin/reviews/google-auth/callback`
}

/**
 * Build the Google OAuth consent URL. The admin clicks this link to authorize.
 * @param state — random string for CSRF protection (store in a cookie)
 */
export function getGoogleAuthUrl(state: string, origin?: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(origin),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',   // gives us a refresh token
    prompt: 'consent',        // force consent so we always get a refresh token
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number       // seconds until expiry (usually 3600)
  token_type: string
  scope: string
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called once after the OAuth callback.
 */
export async function exchangeCodeForTokens(code: string, origin?: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: getRedirectUri(origin),
      grant_type: 'authorization_code',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${body}`)
  }

  return res.json() as Promise<TokenResponse>
}

/**
 * Refresh an expired access token using the stored refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${body}`)
  }

  return res.json() as Promise<TokenResponse>
}

/**
 * Get a valid access token, auto-refreshing if expired.
 *
 * Reads tokens from the google_reviews_config table.
 * If the access token expires within 5 minutes, refreshes it and saves
 * the new one back to the database.
 *
 * Throws 'REAUTH_REQUIRED' if the refresh token is revoked or missing.
 * Throws 'NOT_CONNECTED' if OAuth has never been set up.
 */
export async function getValidAccessToken(): Promise<{
  accessToken: string
  accountId: string
  locationId: string
}> {
  const supabase = createAdminClient()

  const { data: config } = await supabase
    .from('google_reviews_config')
    .select('access_token, refresh_token, token_expires_at, google_account_id, google_location_id')
    .limit(1)
    .single()

  if (!config?.access_token || !config?.refresh_token) {
    throw new Error('NOT_CONNECTED')
  }

  if (!config.google_account_id || !config.google_location_id) {
    throw new Error('NOT_CONNECTED')
  }

  // Check if token needs refreshing (5-minute buffer)
  const expiresAt = config.token_expires_at
    ? new Date(config.token_expires_at).getTime()
    : 0
  const fiveMinutes = 5 * 60 * 1000
  const needsRefresh = Date.now() > expiresAt - fiveMinutes

  if (!needsRefresh) {
    return {
      accessToken: config.access_token,
      accountId: config.google_account_id,
      locationId: config.google_location_id,
    }
  }

  // Refresh the token
  try {
    const tokens = await refreshAccessToken(config.refresh_token)

    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    await supabase
      .from('google_reviews_config')
      .update({
        access_token: tokens.access_token,
        token_expires_at: newExpiresAt,
      })
      .eq('google_account_id', config.google_account_id)

    return {
      accessToken: tokens.access_token,
      accountId: config.google_account_id,
      locationId: config.google_location_id,
    }
  } catch {
    throw new Error('REAUTH_REQUIRED')
  }
}
