import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDashboardPath } from '@/lib/auth/types'
import type { UserProfile } from '@/lib/auth/types'

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

  // Use admin client (standard createClient, NOT SSR wrapper) so the
  // service role key genuinely bypasses RLS. The SSR createServerClient
  // was still subject to RLS even with the service key.
  const admin = createAdminClient()

  let { data: profile } = await admin
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Auto-create profile for new users (e.g. first-time OTP sign-in)
  if (!profile) {
    const { data: newProfile, error: insertError } = await admin
      .from('user_profiles')
      .insert({
        id: user.id,
        email: user.email ?? '',
        role: 'guest',
        is_active: true,
      })
      .select('*')
      .single()

    if (insertError) {
      console.error('[auth/callback] Failed to create profile:', insertError.message)
      return NextResponse.redirect(`${origin}/${locale}/login?error=no_profile`)
    }

    profile = newProfile
  }

  const typedProfile = profile as UserProfile

  if (!typedProfile.is_active) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=deactivated`)
  }

  // Redirect to the intended page or the role-appropriate dashboard
  const redirectTo = next || getDashboardPath(typedProfile.role, locale)
  return NextResponse.redirect(`${origin}${redirectTo}`)
}
