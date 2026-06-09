import {
  COOKIE_VISITOR_ID,
  COOKIE_SESSION_ID,
  COOKIE_ATTRIBUTION,
  COOKIE_GCLID,
  COOKIE_CLICK_TYPE,
  VISITOR_COOKIE_DAYS,
  GCLID_COOKIE_DAYS,
  SESSION_TIMEOUT_MINUTES,
  UTM_PARAMS,
  SOCIAL_SOURCES,
  type UTMParams,
} from './constants'
import { pickClickId } from './click-ids'

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

// ── Anonymous session/visitor IDs (no consent required) ──
//
// Session-scoped IDs stored in sessionStorage — NOT cookies. They live only
// until the tab closes, never persist across visits, and never leave first-party
// scope, so they don't carry the consent obligations of tracking cookies. We
// already record anonymous sessions server-side without consent; this just makes
// the id stable within a single visit so (a) analytics rows de-duplicate per tab
// and (b) a resulting booking can be linked back to the visit that produced it.

const ANON_SESSION_KEY = 'oc_anon_session'
const ANON_VISITOR_KEY = 'oc_anon_visitor'

function getOrCreateFromSessionStorage(key: string): string {
  if (typeof window === 'undefined') return generateAnonId()
  try {
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    const id = generateAnonId()
    window.sessionStorage.setItem(key, id)
    return id
  } catch {
    // sessionStorage blocked (private mode / strict settings) — fall back to throwaway
    return generateAnonId()
  }
}

function generateAnonId(): string {
  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Stable-per-tab anonymous session id (sessionStorage). */
export function getOrCreateAnonSessionId(): string {
  return getOrCreateFromSessionStorage(ANON_SESSION_KEY)
}

/** Stable-per-tab anonymous visitor id (sessionStorage). */
export function getOrCreateAnonVisitorId(): string {
  return getOrCreateFromSessionStorage(ANON_VISITOR_KEY)
}

/** Read the anon session id without creating one (returns null if absent). */
export function getAnonSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(ANON_SESSION_KEY)
  } catch {
    return null
  }
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

// ── Google ad click ids (gclid / wbraid / gbraid) ──
//
// Captured client-side on ad landings as a FALLBACK to the /t/<slug> redirect
// (which captures it server-side). Stored first-party so it survives the booking
// flow and the iDEAL redirect. Only the *send to Google* is consent-gated, not
// this capture — it's our own data.
//
// The value goes in oc_gclid and its kind in oc_click_type, so the eventual
// upload can target the correct API field (gbraid/wbraid don't match as gclid).

export function captureClickIdsFromURL(): void {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const picked = pickClickId((k) => params.get(k))
  if (picked) {
    setCookie(COOKIE_GCLID, picked.value, GCLID_COOKIE_DAYS)
    setCookie(COOKIE_CLICK_TYPE, picked.type, GCLID_COOKIE_DAYS)
  }
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
