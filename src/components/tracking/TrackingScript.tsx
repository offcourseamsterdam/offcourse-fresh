'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { initSession, initAnonymousSession, trackEvent } from '@/lib/tracking/client'
import { getCookie } from '@/lib/tracking/attribution'
import { COOKIE_CONSENT } from '@/lib/tracking/constants'

/**
 * First-party tracking script. Renders nothing visible.
 *
 * Two modes:
 * - With consent (oc_consent=yes): full tracking with persistent cookies
 * - Without consent: anonymous server-side visit counter only, no cookies
 *
 * Either way, the visit counter goes up.
 */
export function TrackingScript() {
  const pathname = usePathname()

  // Initialize on first mount
  useEffect(() => {
    const consent = getCookie(COOKIE_CONSENT)

    if (consent === 'yes') {
      // Full tracking — persistent cookies, cross-visit attribution
      initSession()
      if (typeof window !== 'undefined') {
        ;(window as unknown as Record<string, unknown>).__ocTrack = trackEvent
      }
    } else {
      // No consent yet (or declined) — still count the visit, just no cookies
      initAnonymousSession()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Track page views on route changes — only with consent
  useEffect(() => {
    const consent = getCookie(COOKIE_CONSENT)
    if (consent !== 'yes') return
    trackEvent('page_view', { path: pathname })
  }, [pathname])

  return null
}
