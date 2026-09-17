import { locales, type Locale } from '@/lib/i18n/config'

export interface MarkdownRouteMatch {
  /** Internal API route to rewrite to. */
  pathname: string
  locale: Locale
}

const LOCALE_GROUP = locales.join('|')
const HOME_RE = new RegExp(`^/(${LOCALE_GROUP})/?$`)
const CRUISE_RE = new RegExp(`^/(${LOCALE_GROUP})/cruises/([^/]+)/?$`)
const BLOG_RE = new RegExp(`^/(${LOCALE_GROUP})/blog/([^/]+)/?$`)

/**
 * Maps a locale-prefixed public page path to its markdown-rendering API
 * route, for proxy.ts to rewrite to when a request sends
 * `Accept: text/markdown`. Returns null for any page we don't hand-author a
 * markdown variant for — those keep serving HTML regardless of the Accept
 * header.
 */
export function matchMarkdownRoute(pathname: string): MarkdownRouteMatch | null {
  let m = pathname.match(CRUISE_RE)
  if (m) return { pathname: `/api/markdown/cruises/${m[2]}`, locale: m[1] as Locale }

  m = pathname.match(BLOG_RE)
  if (m) return { pathname: `/api/markdown/blog/${m[2]}`, locale: m[1] as Locale }

  m = pathname.match(HOME_RE)
  if (m) return { pathname: '/api/markdown/home', locale: m[1] as Locale }

  return null
}

/** True for the locale-prefixed homepage (`/en`, `/nl/`, etc.) — used to gate the agent-discovery Link header. */
export function isHomepagePath(pathname: string): boolean {
  return HOME_RE.test(pathname)
}
