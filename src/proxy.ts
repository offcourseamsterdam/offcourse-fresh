import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const DEFAULT_LOCALE = 'en'
const LOCALE_RE = /^\/(en|nl|de|fr|es|pt|zh)(\/|$)/

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

  // ── Locale redirect ─────────────────────────────────────────────────────
  // If no locale prefix → redirect to /en
  const match = pathname.match(LOCALE_RE)
  if (!match) {
    const url = request.nextUrl.clone()
    url.pathname = `/${DEFAULT_LOCALE}${pathname}`
    return NextResponse.redirect(url)
  }

  // ── x-pathname header ───────────────────────────────────────────────────
  // Set x-pathname on the REQUEST headers (not response!) so server
  // components can read it via headers().get('x-pathname').
  // Used by [locale]/layout.tsx to hide Navbar/Footer on admin/partner routes.
  const pathWithoutLocale = pathname.slice(match[1].length + 1) || '/'
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathWithoutLocale)

  // Start with a response that forwards the updated request headers
  let response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // ── Session refresh ─────────────────────────────────────────────────────
  // @supabase/ssr requires calling getUser() in middleware so it can
  // silently refresh the access token with the refresh-token cookie.
  // Without this, the session expires after ~1 hour and the user is logged out.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Rebuild response (preserving x-pathname on requestHeaders)
          // then write the refreshed auth cookies onto it for the browser.
          response = NextResponse.next({ request: { headers: requestHeaders } })
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
