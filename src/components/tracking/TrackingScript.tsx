'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { initSession, trackEvent } from '@/lib/tracking/client'

/**
 * First-party tracking script. Renders nothing visible.
 *
 * On mount: creates/refreshes visitor + session cookies, sends session data
 * to /api/tracking/session, and exposes trackEvent on window for other
 * components to use imperatively.
 *
 * On route change: increments page count and refreshes session cookie.
 */
export function TrackingScript() {
  const pathname = usePathname()

  // Initialize on first mount
  useEffect(() => {
    initSession()

    // Expose trackEvent globally so non-React code can use it
    if (typeof window !== 'undefined') {
      ;(window as unknown as Record<string, unknown>).__ocTrack = trackEvent
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Track page views on route changes (after initial mount)
  useEffect(() => {
    // The initSession call on mount handles the first page view.
    // Subsequent pathname changes fire a page_view event.
    trackEvent('page_view', { path: pathname })
  }, [pathname])

  return null
}
