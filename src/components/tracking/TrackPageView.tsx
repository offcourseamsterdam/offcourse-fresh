'use client'

import { useEffect } from 'react'
import { trackEvent } from '@/lib/tracking/client'
import type { TrackingEventName } from '@/lib/tracking/constants'

/**
 * Drop-in client component to fire a tracking event on mount.
 * Use in server-rendered pages:
 *
 *   <TrackPageView event="view_homepage" />
 *   <TrackPageView event="view_cruise_detail" metadata={{ slug: 'sunset-cruise' }} />
 */
export function TrackPageView({
  event,
  metadata,
}: {
  event: TrackingEventName
  metadata?: Record<string, unknown>
}) {
  useEffect(() => {
    trackEvent(event, metadata)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
