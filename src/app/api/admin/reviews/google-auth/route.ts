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
 */
export async function GET(request: Request) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  // Extract locale from referer so we can redirect back to the right locale after OAuth
  const referer = request.headers.get('referer') ?? ''
  const localeMatch = referer.match(/\/(\w{2})\/admin\//)
  const locale = localeMatch?.[1] ?? 'en'

  // Generate random state for CSRF protection
  const state = crypto.randomUUID()

  // Store state + locale in short-lived cookies for the callback
  const cookieStore = await cookies()
  cookieStore.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  cookieStore.set('google_oauth_locale', locale, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const authUrl = getGoogleAuthUrl(state)

  return NextResponse.redirect(authUrl)
}
