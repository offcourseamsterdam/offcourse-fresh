import { NextRequest, NextResponse } from 'next/server'

// Locales supported (must match i18n config)
const LOCALES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'zh']
const LOCALE_REGEX = new RegExp(`^/(${LOCALES.join('|')})(/|$)`)

// Route prefixes (after stripping locale) that require authentication
const PROTECTED_PREFIXES = ['/admin', '/captain', '/support', '/partner', '/account']

// Lazy-initialized on first request, cached for all subsequent ones.
// This avoids top-level imports of next-intl/middleware (86 dev JS files)
// and @supabase/ssr (124 JS files) which cause Turbopack to hang at startup.
let _intlMiddleware: ((req: NextRequest) => NextResponse) | null = null

async function getIntlMiddleware() {
  if (!_intlMiddleware) {
    const createMiddleware = (await import('next-intl/middleware')).default
    const { routing } = await import('@/i18n/routing')
    _intlMiddleware = createMiddleware(routing)
  }
  return _intlMiddleware
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API routes and auth callbacks are handled by Next.js directly — skip intl
  if (pathname.startsWith('/auth/') || pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Run next-intl middleware for locale detection/rewriting
  const intlMiddleware = await getIntlMiddleware()
  const intlResponse = intlMiddleware(request)

  const response = intlResponse instanceof NextResponse
    ? intlResponse
    : NextResponse.next({ request })

  // Determine the locale prefix from the path
  const localeMatch = pathname.match(LOCALE_REGEX)
  const pathWithoutLocale = localeMatch
    ? pathname.slice(localeMatch[1].length + 1) || '/'
    : pathname
  const locale = localeMatch?.[1] || 'en'

  // Only check auth for protected routes — skip Supabase call for public pages
  const isProtected = PROTECTED_PREFIXES.some(prefix =>
    pathWithoutLocale === prefix || pathWithoutLocale.startsWith(prefix + '/')
  )

  // Skip auth in development — remove before going to production
  if (isProtected && process.env.NODE_ENV !== 'development') {
    const { createMiddlewareClient } = await import('@/lib/auth/middleware')
    const supabase = createMiddlewareClient(request, response)
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const loginUrl = new URL(`/${locale}/login`, request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // Pass pathname to layouts so they can conditionally render elements
  response.headers.set('x-pathname', pathWithoutLocale)

  return response
}

export const config = {
  // Match all paths except static files, images, and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|.*\\..*).*)'],
}
