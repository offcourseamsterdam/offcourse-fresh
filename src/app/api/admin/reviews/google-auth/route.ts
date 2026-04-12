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
export async function GET() {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  // Generate random state for CSRF protection
  const state = crypto.randomUUID()

  // Store state in a short-lived cookie so we can validate it in the callback
  const cookieStore = await cookies()
  cookieStore.set('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  const authUrl = getGoogleAuthUrl(state)

  return NextResponse.redirect(authUrl)
}
