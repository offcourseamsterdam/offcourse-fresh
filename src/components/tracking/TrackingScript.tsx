'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { initSession, trackEvent } from '@/lib/tracking/client'
import { getCookie } from '@/lib/tracking/attribution'
import { COOKIE_CONSENT } from '@/lib/tracking/constants'

/**
 * First-party tracking script. Renders nothing visible.
 *
 * Only initializes cookie-based tracking if the user has consented (oc_consent=yes).
 * The CookieBanner component handles calling initSession() on accept.
 * This component handles subsequent page loads where consent already exists.
 */
export function TrackingScript() {
  const pathname = usePathname()

  // Initialize on first mount — only if consent given
  useEffect(() => {
    const consent = getCookie(COOKIE_CONSENT)
    if (consent !== 'yes') return

    initSession()

    if (typeof window !== 'undefined') {
      ;(window as unknown as Record<string, unknown>).__ocTrack = trackEvent
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Track page views on route changes — only if consent given
  useEffect(() => {
    const consent = getCookie(COOKIE_CONSENT)
    if (consent !== 'yes') return
    trackEvent('page_view', { path: pathname })
  }, [pathname])

  return null
}
