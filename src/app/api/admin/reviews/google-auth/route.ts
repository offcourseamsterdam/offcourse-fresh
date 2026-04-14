import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { apiError } from '@/lib/api/response'
import { requireRole } from '@/lib/auth/server'
import { getGoogleAuthUrl } from '@/lib/google-reviews/oauth'

/**
 * GET /api/admin/reviews/google-auth
 *
 * Starts the OAuth 2.0 flow by redirecting to Google's consent screen.
 * The admin clicks "Connect Google Business" in the UI → this route
 * generates a state nonce (CSRF protection) and redirects to Google.
 *
 * The request's actual origin is stored in a cookie so the callback
 * uses the same redirect_uri (required by Google OAuth).
 */
export async function GET(request: Request) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  // Use the actual request origin so the redirect_uri matches
  // whether we're on offcourse-fresh.vercel.app or offcourseamsterdam.com
  const requestUrl = new URL(request.url)
  const origin = requestUrl.origin

  // Extract locale from referer so we can redirect back to the right locale after OAuth
  const referer = request.headers.get('referer') ?? ''
  const localeMatch = referer.match(/\/(\w{2})\/admin\//)
  const locale = localeMatch?.[1] ?? 'en'

  // Generate random state for CSRF protection
  const state = crypto.randomUUID()

  // Store state + locale + origin in short-lived cookies for the callback
  const cookieStore = await cookies()
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  }
  cookieStore.set('google_oauth_state', state, cookieOpts)
  cookieStore.set('google_oauth_locale', locale, cookieOpts)
  cookieStore.set('google_oauth_origin', origin, cookieOpts)

  try {
    const authUrl = getGoogleAuthUrl(state, origin)
    return NextResponse.redirect(authUrl)
  } catch (err) {
    console.error('[google-auth] Failed to build auth URL:', err)
    return apiError(
      'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in environment variables.',
      503,
    )
  }
}
