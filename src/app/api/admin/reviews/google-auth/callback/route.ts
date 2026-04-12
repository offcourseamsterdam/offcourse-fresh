import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google-reviews/oauth'
import { listAccounts, listLocations } from '@/lib/google-reviews/business-profile'

/**
 * GET /api/admin/reviews/google-auth/callback
 *
 * Google redirects here after the user consents. We:
 * 1. Validate the state param (CSRF check)
 * 2. Exchange the code for access + refresh tokens
 * 3. Discover the GBP account and location IDs
 * 4. Store everything in google_reviews_config
 * 5. Redirect back to the admin reviews page
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  // Determine where to redirect back to (use referer locale or default to /en)
  const adminReviewsUrl = (locale: string) =>
    `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/${locale}/admin/reviews`

  const locale = 'en' // Default locale for redirect

  // User denied consent
  if (error) {
    return NextResponse.redirect(`${adminReviewsUrl(locale)}?gbp_error=consent_denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${adminReviewsUrl(locale)}?gbp_error=missing_params`)
  }

  // Validate state against cookie
  const cookieStore = await cookies()
  const storedState = cookieStore.get('google_oauth_state')?.value

  if (!storedState || storedState !== state) {
    return NextResponse.redirect(`${adminReviewsUrl(locale)}?gbp_error=state_mismatch`)
  }

  // Clear the state cookie
  cookieStore.delete('google_oauth_state')

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code)

    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${adminReviewsUrl(locale)}?gbp_error=no_refresh_token`)
    }

    // Discover Business Profile account and location
    const accounts = await listAccounts(tokens.access_token)
    if (accounts.length === 0) {
      return NextResponse.redirect(
        `${adminReviewsUrl(locale)}?gbp_error=no_business_account`
      )
    }

    // Use the first account (small business typically has one)
    const account = accounts[0]

    const locations = await listLocations(tokens.access_token, account.name)
    if (locations.length === 0) {
      return NextResponse.redirect(
        `${adminReviewsUrl(locale)}?gbp_error=no_locations`
      )
    }

    // Use the first location (Off Course Amsterdam has one location)
    const location = locations[0]

    // Get the user's email for display in admin
    let email: string | null = null
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json() as { email?: string }
        email = userInfo.email ?? null
      }
    } catch {
      // Not critical — email is just for display
    }

    // Store tokens and account info in the config table
    const supabase = await createServiceClient()
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const oauthData = {
      gbp_account_id: account.name,
      gbp_location_id: location.name,
      oauth_access_token: tokens.access_token,
      oauth_refresh_token: tokens.refresh_token,
      oauth_token_expires_at: expiresAt,
      oauth_connected_at: new Date().toISOString(),
      oauth_email: email,
    }

    // Update existing config row or insert if none exists
    const { data: existing } = await supabase
      .from('google_reviews_config')
      .select('id')
      .limit(1)
      .single()

    if (existing) {
      await supabase
        .from('google_reviews_config')
        .update(oauthData)
        .eq('id', existing.id)
    } else {
      // Need a place_id to insert — use env var or empty string
      await supabase
        .from('google_reviews_config')
        .insert({
          ...oauthData,
          place_id: process.env.GOOGLE_PLACE_ID ?? '',
        })
    }

    return NextResponse.redirect(`${adminReviewsUrl(locale)}?google_connected=true`)
  } catch (err) {
    console.error('OAuth callback error:', err)
    const message = err instanceof Error ? err.message : 'unknown_error'
    return NextResponse.redirect(
      `${adminReviewsUrl(locale)}?gbp_error=${encodeURIComponent(message)}`
    )
  }
}
