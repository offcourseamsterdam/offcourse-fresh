'use client'

import { useState, useEffect } from 'react'
import { getCookie, setCookie } from '@/lib/tracking/attribution'
import { COOKIE_CONSENT } from '@/lib/tracking/constants'
import { initSession } from '@/lib/tracking/client'

/**
 * Minimal cookie consent banner. Shows once on first visit.
 * Accepts → sets oc_consent=yes, starts tracking.
 * Declines → sets oc_consent=no, no tracking cookies.
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Don't show if consent already given (either way)
    const consent = getCookie(COOKIE_CONSENT)
    if (!consent) setVisible(true)
  }, [])

  function handleAccept() {
    setCookie(COOKIE_CONSENT, 'yes', 365)
    setVisible(false)
    // Start tracking immediately now that we have consent
    initSession()
  }

  function handleDecline() {
    setCookie(COOKIE_CONSENT, 'no', 365)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto bg-white/95 backdrop-blur-sm border border-zinc-200 rounded-2xl shadow-lg px-5 py-3.5 flex items-center gap-4 max-w-lg w-full animate-slideDown">
        <p className="text-sm text-zinc-600 flex-1">
          <span className="mr-1.5">🍪</span>
          We use cookies to remember where you found us. This helps the crew stay afloat.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleDecline}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
          >
            Nah
          </button>
          <button
            onClick={handleAccept}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
          >
            Yeah, cool
          </button>
        </div>
      </div>
    </div>
  )
}
