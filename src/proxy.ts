import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { locales, defaultLocale } from '@/lib/i18n/config'
import { matchMarkdownRoute, isHomepagePath } from '@/lib/markdown/match-agent-route'
import { buildHomepageLinkHeader } from '@/lib/agent-discovery/link-header'

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

  // ── Branded short links (map / review) ──────────────────────────────────
  // /r/<code> is a public, locale-less route (src/app/r/[code]/route.ts —
  // the review-SMS redirector). Bypass the locale redirect so it doesn't
  // become /en/r/<code> (which doesn't exist) → 404.
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

  // A response builder for the rest of this function, so the homepage's
  // agent-discovery Link header (RFC 8288 + RFC 9727 §3) lands regardless of
  // which branch below actually serves the request.
  const isHome = isHomepagePath(pathname)
  const withDiscoveryHeader = (res: NextResponse) => {
    if (isHome) res.headers.set('Link', buildHomepageLinkHeader())
    return res
  }

  // ── Markdown content negotiation (agent readiness) ──────────────────────
  // AI agents that prefer clean text over HTML send `Accept: text/markdown`
  // instead of the browser's usual header. Rewrite transparently to a
  // hand-authored markdown variant for the page types worth writing one for
  // (homepage, cruise pages, blog posts) — same URL, same params, just a
  // different Content-Type. Every other page keeps serving HTML regardless
  // of the Accept header. See docs/features/markdown-for-agents.md.
  if ((request.headers.get('accept') ?? '').includes('text/markdown')) {
    const markdownRoute = matchMarkdownRoute(pathname)
    if (markdownRoute) {
      const url = request.nextUrl.clone()
      url.pathname = markdownRoute.pathname
      url.search = ''
      url.searchParams.set('locale', markdownRoute.locale)
      return withDiscoveryHeader(NextResponse.rewrite(url))
    }
  }

  // ── Session refresh ─────────────────────────────────────────────────────
  // @supabase/ssr requires calling getUser() in middleware so it can
  // silently refresh the access token with the refresh-token cookie.
  // Without this, the session expires after ~1 hour and the user is logged out.
  // Skip entirely for anonymous visitors — they have no sb-* cookie to refresh,
  // and the Supabase network round-trip is wasted on every page view.
  const hasAuthCookie = request.cookies.getAll().some(c => c.name.startsWith('sb-'))
  if (!hasAuthCookie) return withDiscoveryHeader(NextResponse.next())

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

  return withDiscoveryHeader(response)
}

export const config = {
  // Match all paths except static files, images, and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|.*\\..*).*)'],
}
