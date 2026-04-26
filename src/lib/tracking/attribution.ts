import {
  COOKIE_VISITOR_ID,
  COOKIE_SESSION_ID,
  COOKIE_ATTRIBUTION,
  VISITOR_COOKIE_DAYS,
  SESSION_TIMEOUT_MINUTES,
  UTM_PARAMS,
  SOCIAL_SOURCES,
  type UTMParams,
} from './constants'

// ── Cookie helpers (browser-only) ──

export function setCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function deleteCookie(name: string) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`
}

// ── ID generation ──

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ── Visitor ID (persistent, 1 year) ──

export function getOrCreateVisitorId(): string {
  const existing = getCookie(COOKIE_VISITOR_ID)
  if (existing) return existing
  const id = generateId()
  setCookie(COOKIE_VISITOR_ID, id, VISITOR_COOKIE_DAYS)
  return id
}

// ── Session ID (30-min sliding window) ──

export function getOrCreateSessionId(): string {
  const existing = getCookie(COOKIE_SESSION_ID)
  if (existing) {
    // Refresh the sliding window
    setCookie(COOKIE_SESSION_ID, existing, SESSION_TIMEOUT_MINUTES / (24 * 60))
    return existing
  }
  const id = generateId()
  setCookie(COOKIE_SESSION_ID, id, SESSION_TIMEOUT_MINUTES / (24 * 60))
  return id
}

// ── UTM parsing ──

export function parseUTMFromURL(url: string): UTMParams {
  try {
    const params = new URL(url).searchParams
    const result: UTMParams = {}
    for (const key of UTM_PARAMS) {
      const val = params.get(key)
      if (val) result[key] = val
    }
    return result
  } catch {
    return {}
  }
}

export function hasUTMParams(utm: UTMParams): boolean {
  return Object.values(utm).some(Boolean)
}

// ── Attribution cookie ──
//
// The attribution cookie (oc_attr) is written ONLY by the server (via /api/t/[slug]
// or /api/track/visit) and read here. The shape mirrors what
// `buildAttributionCookie` in src/lib/tracking/server.ts produces.
//
// UTM params, referrer, and landing_page are recorded per-session in
// analytics_sessions, not in this cookie — keeps the cookie small and lets the
// server be the single source of truth for campaign attribution.

export interface AttributionData {
  campaign_slug?: string
  campaign_id?: string
  partner_id?: string | null
  campaign_link_id?: string | null
  // Legacy fields kept optional so old cookies still parse without throwing.
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

export function getAttribution(): AttributionData | null {
  const raw = getCookie(COOKIE_ATTRIBUTION)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AttributionData
  } catch {
    return null
  }
}

// ── Channel resolution (server-side, maps UTM to channel slug) ──

const SEARCH_ENGINES = ['google', 'bing', 'duckduckgo', 'yahoo', 'baidu', 'ecosia']

export function resolveChannelSlug(
  utm_source?: string | null,
  utm_medium?: string | null,
  referrer?: string | null,
): string {
  const src = (utm_source || '').toLowerCase()
  const med = (utm_medium || '').toLowerCase()

  // Paid search / PPC
  if (med === 'cpc' || med === 'ppc' || med === 'paid') return 'google-ads'

  // Social media
  if (SOCIAL_SOURCES.some((s) => src.includes(s))) return 'social'
  if (med === 'social') return 'social'

  // Email
  if (src === 'email' || med === 'email' || src === 'newsletter') return 'email'

  // Partner / affiliate (explicit)
  if (med === 'partner' || med === 'affiliate') return 'partners'

  // Referral (explicit UTM)
  if (med === 'referral') return 'referral'

  // No UTM but has referrer — check if organic search or referral
  if (!src && !med && referrer) {
    try {
      const refHost = new URL(referrer).hostname.toLowerCase()
      if (SEARCH_ENGINES.some((se) => refHost.includes(se))) return 'organic'
      return 'referral'
    } catch {
      return 'referral'
    }
  }

  // Has UTM source but didn't match anything specific
  if (src) return 'referral'

  // No UTM, no referrer
  return 'direct'
}
