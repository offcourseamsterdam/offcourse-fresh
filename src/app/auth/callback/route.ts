import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDashboardPath } from '@/lib/auth/types'
import type { UserProfile } from '@/lib/auth/types'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') // optional redirect target
  const locale = searchParams.get('locale') || 'en'

  if (!code) {
    return NextResponse.redirect(`${origin}/en/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession error:', error.message)
    return NextResponse.redirect(`${origin}/en/login?error=auth_failed`)
  }

  // Fetch user profile to determine where to redirect
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/en/login?error=no_user`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.redirect(`${origin}/en/login?error=no_profile`)
  }

  const typedProfile = profile as UserProfile

  if (!typedProfile.is_active) {
    return NextResponse.redirect(`${origin}/en/login?error=deactivated`)
  }

  // Redirect to the intended page or the role-appropriate dashboard
  const redirectTo = next || getDashboardPath(typedProfile.role, locale)
  return NextResponse.redirect(`${origin}${redirectTo}`)
}
