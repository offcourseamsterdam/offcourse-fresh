import { NextRequest, NextResponse } from 'next/server'

const LOCALES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'zh']
const DEFAULT_LOCALE = 'en'
const LOCALE_RE = /^\/(en|nl|de|fr|es|pt|zh)(\/|$)/

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip internal, API, and auth routes
  if (pathname.startsWith('/_next/') || pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    return NextResponse.next()
  }

  // If no locale prefix → redirect to /en
  const match = pathname.match(LOCALE_RE)
  if (!match) {
    const url = request.nextUrl.clone()
    url.pathname = `/${DEFAULT_LOCALE}${pathname}`
    return NextResponse.redirect(url)
  }

  // Set x-pathname for layout detection (admin sidebar, etc.)
  const pathWithoutLocale = pathname.slice(match[1].length + 1) || '/'
  const response = NextResponse.next()
  response.headers.set('x-pathname', pathWithoutLocale)
  return response
}

export const config = {
  // Match all paths except static files, images, and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|.*\\..*).*)'],
}
