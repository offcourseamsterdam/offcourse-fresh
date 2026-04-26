/**
 * Browser-side tracking client.
 * Uses sendBeacon for fire-and-forget delivery that survives page transitions.
 */
import type { TrackingEventName } from './constants'
import { COOKIE_SESSION_ID, COOKIE_VISITOR_ID } from './constants'
import {
  getCookie,
  getOrCreateVisitorId,
  getOrCreateSessionId,
  parseUTMFromURL,
  getAttribution,
} from './attribution'

let pageViewCount = 0
let lastInitTime = 0
let visibilityListenerAdded = false

/**
 * Events that have already fired in this session.
 * Prevents duplicate funnel events when users go back and forth.
 * page_view is exempt — each navigation counts.
 * Reset when a new session starts.
 */
const firedEvents = new Set<string>()

/** Initialize tracking on page load. Call once in TrackingScript. */
export function initSession() {
  // Debounce: skip if called within 2 seconds (fast SPA navigation)
  const now = Date.now()
  if (now - lastInitTime < 2000) return
  lastInitTime = now

  const visitorId = getOrCreateVisitorId()
  const sessionId = getOrCreateSessionId()
  firedEvents.clear() // New session init = reset dedup
  pageViewCount++

  const utm = parseUTMFromURL(window.location.href)
  // Attribution cookie is set ONLY by the server (/api/t/[slug] redirect).
  // We just read it here.
  const attr = getAttribution()

  // Send session start/update to our API
  const payload = {
    visitor_id: visitorId,
    session_id: sessionId,
    entry_page: window.location.pathname,
    referrer: document.referrer || undefined,
    page_count: pageViewCount,
    utm_source: attr?.utm_source || utm.utm_source,
    utm_medium: attr?.utm_medium || utm.utm_medium,
    utm_campaign: attr?.utm_campaign || utm.utm_campaign,
    utm_term: attr?.utm_term || utm.utm_term,
    utm_content: attr?.utm_content || utm.utm_content,
    campaign_slug: attr?.campaign_slug,
  }

  // Use fetch (not sendBeacon) for session — we want the session to be created
  // before any funnel events fire
  fetch('/api/tracking/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Tracking failures are silent — never break the user experience
  })

  // On page hide, send session close with final page count
  if (!visibilityListenerAdded) {
    visibilityListenerAdded = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        const blob = new Blob(
          [JSON.stringify({
            session_id: sessionId,
            exit_page: window.location.pathname,
            page_count: pageViewCount,
          })],
          { type: 'application/json' },
        )
        navigator.sendBeacon('/api/tracking/session', blob)
      }
    })
  }
}

/**
 * Record an anonymous visit server-side WITHOUT setting any cookies.
 * Used when consent hasn't been given yet — we still count the visit,
 * we just can't connect it to future visits.
 *
 * We DO read the oc_attr attribution cookie (set by the server via /api/t/[slug])
 * so that campaign_slug is captured even for first-time visitors who haven't
 * accepted cookies yet. The cookie itself was set by the server, not by us.
 */
export function initAnonymousSession() {
  pageViewCount++

  // Parse UTM from URL (no cookie needed — URL is public)
  const utm = parseUTMFromURL(window.location.href)
  // Read server-set attribution cookie so campaign is captured even without consent
  const attr = getAttribution()

  // Generate throwaway IDs (not stored in cookies)
  const anonVisitorId = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const anonSessionId = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  fetch('/api/tracking/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitor_id: anonVisitorId,
      session_id: anonSessionId,
      entry_page: window.location.pathname,
      referrer: document.referrer || undefined,
      page_count: pageViewCount,
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      utm_term: utm.utm_term,
      utm_content: utm.utm_content,
      campaign_slug: attr?.campaign_slug,
    }),
    keepalive: true,
  }).catch(() => {})
}

/** Track a funnel event. Fire-and-forget via sendBeacon. */
export function trackEvent(name: TrackingEventName, metadata?: Record<string, unknown>) {
  const visitorId = getCookie(COOKIE_VISITOR_ID)
  const sessionId = getCookie(COOKIE_SESSION_ID)
  if (!visitorId || !sessionId) return

  // Dedup: skip if this funnel event already fired in this session.
  // page_view is exempt (each navigation counts).
  if (name !== 'page_view') {
    if (firedEvents.has(name)) return
    firedEvents.add(name)
  }

  const blob = new Blob(
    [JSON.stringify({
      session_id: sessionId,
      visitor_id: visitorId,
      event_name: name,
      metadata: metadata || undefined,
    })],
    { type: 'application/json' },
  )
  navigator.sendBeacon('/api/tracking/event', blob)
}

/** Get the current session ID (for passing into booking requests). */
export function getSessionId(): string | null {
  return getCookie(COOKIE_SESSION_ID)
}

/** Get the current visitor ID. */
export function getVisitorId(): string | null {
  return getCookie(COOKIE_VISITOR_ID)
}
