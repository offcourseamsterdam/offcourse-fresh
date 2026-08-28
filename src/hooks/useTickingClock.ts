'use client'

import { useEffect, useState } from 'react'

/**
 * A `Date.now()` value that re-renders its caller every `intervalMs` while
 * `enabled` — for a countdown/live-duration display that should visibly move
 * without re-polling an API just to keep a clock ticking. Was hand-rolled
 * identically in ConversationList.tsx and ThreadPane.tsx (both driving
 * lib/whatsapp/window.ts's `formatWindowRemaining`) before being extracted
 * here; `enabled` lets each caller decide whether ticking is worth it right
 * now (ThreadPane only ticks for an open WhatsApp window with an expiry,
 * ConversationList ticks unconditionally since any row in the list could be one).
 */
export function useTickingClock(enabled: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(interval)
  }, [enabled, intervalMs])
  return now
}
