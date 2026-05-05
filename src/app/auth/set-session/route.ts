import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveProfile } from '@/lib/auth/resolve-profile'
import { getDashboardPath } from '@/lib/auth/types'

/**
 * POST /auth/set-session
 *
 * Called by the /auth/callback client-side script when Supabase uses the
 * implicit flow (tokens arrive in the URL hash instead of as a ?code= param).
 *
 * Receives { access_token, refresh_token, locale, next } as JSON.
 * Sets the Supabase session via cookies, resolves the user's role, and
 * returns { redirect: "/en/partner" } (or whichever dashboard applies).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { access_token, refresh_token, locale = 'en', next } = body as {
      access_token: string
      refresh_token: string
      locale?: string
      next?: string | null
    }

    if (!access_token || !refresh_token) {
      return NextResponse.json({ error: 'missing_tokens' }, { status: 400 })
    }

    const supabase = await createClient()

    // Establish the session — this writes the auth cookies onto the response
    const { error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    })

    if (sessionError) {
      console.error('[set-session] setSession error:', sessionError.message)
      return NextResponse.json({ error: 'auth_failed' }, { status: 401 })
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'no_user' }, { status: 401 })
    }

    // Resolve role → pick the correct dashboard
    const admin = createAdminClient()
    const { profile, error: profileError } = await resolveProfile(admin, user)

    if (profileError || !profile) {
      return NextResponse.json({ error: profileError ?? 'no_profile' }, { status: 403 })
    }

    const redirect = next || getDashboardPath(profile.role, locale)
    return NextResponse.json({ redirect })
  } catch (err) {
    console.error('[set-session] unexpected error:', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
