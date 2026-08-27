import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { locales, defaultLocale } from '@/lib/i18n/config'

// Built from the canonical locales list (src/lib/i18n/config.ts) — proxy.ts is
// the routing gate, so a hardcoded copy here that drifts from that list would
// silently break locale routing for any locale added later.
const LOCALE_RE = new RegExp(`^/(${locales.join('|')})(/|$)`)

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip internal, API, and auth routes — no session refresh needed
  if (pathname.startsWith('/_next/') || pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    return NextResponse.next()
  }

  // ── Tracking link shortcut ──────────────────────────────────────────────
  // /t/<slug> → rewrite to /api/t/<slug> (the tracking redirect handler)
  // Must be before locale redirect, otherwise it becomes /en/t/<slug> → 404
  if (pathname.startsWith('/t/')) {
    const url = request.nextUrl.clone()
    url.pathname = `/api${pathname}`
    return NextResponse.rewrite(url)
  }

  // ── Public partner portal ───────────────────────────────────────────────
  // /partners/<token> is a public, locale-less route. Bypass the locale
  // redirect so it doesn't become /en/partners/... (which doesn't exist).
  if (pathname.startsWith('/partners/')) {
    return NextResponse.next()
  }

  // ── Branded short links ─────────────────────────────────────────────────
  // /r/<code> (e.g. /r/map, /r/review) is a public, locale-less route — the
  // links embedded in SMS/email. Bypass the locale redirect so it doesn't
  // become /en/r/<code> (which doesn't exist and 404s).
  if (pathname.startsWith('/r/')) {
    return NextResponse.next()
  }

  // ── Locale redirect ─────────────────────────────────────────────────────
  // If no locale prefix → redirect to /en
  const match = pathname.match(LOCALE_RE)
  if (!match) {
    const url = request.nextUrl.clone()
    url.pathname = `/${defaultLocale}${pathname}`
    return NextResponse.redirect(url)
  }

  // ── Session refresh ─────────────────────────────────────────────────────
  // @supabase/ssr requires calling getUser() in middleware so it can
  // silently refresh the access token with the refresh-token cookie.
  // Without this, the session expires after ~1 hour and the user is logged out.
  // Skip entirely for anonymous visitors — they have no sb-* cookie to refresh,
  // and the Supabase network round-trip is wasted on every page view.
  const hasAuthCookie = request.cookies.getAll().some(c => c.name.startsWith('sb-'))
  if (!hasAuthCookie) return NextResponse.next()

  let response = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          response = NextResponse.next()
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  await supabase.auth.getUser()

  return response
}

export const config = {
  // Match all paths except static files, images, and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|.*\\..*).*)'],
}
