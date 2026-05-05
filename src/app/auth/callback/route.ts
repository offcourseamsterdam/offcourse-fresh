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

  // ── No code in query string ────────────────────────────────────────────────
  // Supabase sometimes uses the implicit flow and puts tokens in the URL hash
  // (#access_token=...). Hash fragments are never sent to the server, so we
  // return a tiny HTML page that reads the hash client-side and POSTs the
  // tokens to /auth/set-session, which creates the server-side cookie session.
  if (!code) {
    const localeJs = JSON.stringify(locale)
    const nextJs = JSON.stringify(next || null)
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Signing you in…</title>
  <style>
    body{margin:0;display:flex;align-items:center;justify-content:center;
         min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#f4f4f5;color:#71717a;font-size:14px;}
  </style>
</head>
<body>
  <p>Signing you in…</p>
  <script>
    (function () {
      var hash = window.location.hash.slice(1)
      var p = new URLSearchParams(hash)
      var at = p.get('access_token')
      var rt = p.get('refresh_token')
      var locale = ${localeJs}
      var next   = ${nextJs}

      if (!at || !rt) {
        window.location.replace('/' + locale + '/login?error=missing_code')
        return
      }

      fetch('/auth/set-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: at, refresh_token: rt, locale: locale, next: next })
      })
      .then(function (r) { return r.json() })
      .then(function (d) {
        window.location.replace(d.redirect || ('/' + locale + '/partner'))
      })
      .catch(function () {
        window.location.replace('/' + locale + '/login?error=auth_failed')
      })
    })()
  </script>
</body>
</html>`
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // ── PKCE flow: exchange code for session ───────────────────────────────────
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
