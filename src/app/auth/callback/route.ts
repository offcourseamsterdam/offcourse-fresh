import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveProfile } from '@/lib/auth/resolve-profile'
import { getDashboardPath } from '@/lib/auth/types'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') // optional redirect target
  const locale = searchParams.get('locale') || 'en'

  if (!code) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=missing_code`)
  }

  // Exchange code for session (sets auth cookies for the browser)
  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error.message)
    return NextResponse.redirect(`${origin}/${locale}/login?error=auth_failed`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=no_user`)
  }

  // Look up or auto-create profile using admin client (bypasses RLS)
  const admin = createAdminClient()
  const { profile, error: profileError } = await resolveProfile(admin, user)

  if (profileError) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=${profileError}`)
  }

  // Redirect to the intended page or the role-appropriate dashboard
  const redirectTo = next || getDashboardPath(profile!.role, locale)
  return NextResponse.redirect(`${origin}${redirectTo}`)
}
