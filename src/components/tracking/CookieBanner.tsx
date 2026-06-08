'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { getCookie, setCookie } from '@/lib/tracking/attribution'
import { COOKIE_CONSENT } from '@/lib/tracking/constants'
import { initSession } from '@/lib/tracking/client'

/**
 * Cookie consent — banner + "See choices" modal.
 *
 * UX (product decision by Beer, June 2026): the first-screen banner offers
 * "Accept" + "See choices"; the decline path lives INSIDE the modal, not on the
 * banner. This deliberately makes accepting one click and declining two.
 *
 * ⚠️ Compliance note for whoever reads this next: EU/Dutch cookie law (ePrivacy +
 * GDPR, enforced by the Autoriteit Persoonsgegevens) expects refusing to be as
 * easy as accepting. Putting decline behind the modal is a known "dark pattern"
 * that regulators (e.g. CNIL vs Google) have fined. We accept that risk knowingly;
 * to soften it, the modal gives a clear one-click "Save choices" decline and the
 * marketing toggle defaults OFF. Google Consent Mode v2 still models declines
 * (~70–80% of signal) — see GoogleTag.tsx. If a complaint ever lands, the
 * lowest-risk fix is to add a one-click decline back onto the banner here.
 *
 * Consent maps to a single first-party flag (oc_consent = yes|no):
 *   accept  → oc_consent=yes, start first-party tracking, Consent Mode GRANTED
 *   decline → oc_consent=no,  no tracking cookies,        Consent Mode DENIED
 */
export function CookieBanner() {
  const [view, setView] = useState<'hidden' | 'banner' | 'modal'>('hidden')
  const [marketingOn, setMarketingOn] = useState(false)
  const pathname = usePathname()
  const locale = (pathname?.split('/')[1] || 'en').slice(0, 2)

  useEffect(() => {
    // Defer the client-only cookie read off the effect body (avoids a synchronous
    // setState + any hydration flash). queueMicrotask — not requestAnimationFrame —
    // because rAF is throttled/paused in backgrounded tabs, which would delay the
    // banner until the tab regains focus. A microtask always fires. Show the banner
    // only if no choice exists yet.
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled && !getCookie(COOKIE_CONSENT)) setView('banner')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Single place that records consent + flips every downstream switch.
  const applyConsent = useCallback((granted: boolean) => {
    setCookie(COOKIE_CONSENT, granted ? 'yes' : 'no', 365)
    if (granted) initSession() // start first-party tracking immediately
    if (typeof window !== 'undefined' && window.ocUpdateConsent) {
      window.ocUpdateConsent(granted) // Google Consent Mode v2
    }
    setView('hidden')
  }, [])

  // Close the modal with Escape → fall back to the banner (no choice made yet).
  useEffect(() => {
    if (view !== 'modal') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView('banner')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  if (view === 'hidden') return null

  // ── Banner ──────────────────────────────────────────────────────────────────
  if (view === 'banner') {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 flex justify-center pointer-events-none">
        <div className="pointer-events-auto bg-white/95 backdrop-blur-sm border border-zinc-200 rounded-2xl shadow-lg px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 max-w-lg w-full animate-slideDown">
          <p className="text-sm text-zinc-600 flex-1">
            <span className="mr-1.5">🍪</span>
            We use cookies to remember where you found us — it helps the crew keep the lights on and the boats electric.
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setView('modal')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
            >
              See choices
            </button>
            <button
              onClick={() => applyConsent(true)}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
            >
              Yeah, cool
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── "See choices" modal ───────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-choices-title"
    >
      {/* Backdrop — tap to go back to the banner (not a consent choice) */}
      <button
        aria-label="Back"
        onClick={() => setView('banner')}
        className="absolute inset-0 bg-black/40 animate-[fadeIn_200ms_ease-out]"
      />

      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 animate-modal-in">
        <h2 id="cookie-choices-title" className="text-lg font-semibold text-zinc-900">
          Your cookie choices
        </h2>
        <p className="mt-1.5 text-sm text-zinc-500">
          Keep what you like, skip what you don&apos;t. Essentials keep the site and your booking working;
          the rest just helps us see what&apos;s landing.
        </p>

        <div className="mt-5 space-y-3">
          {/* Essential — always on */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-zinc-900">Essential</p>
              <p className="text-xs text-zinc-500">Needed for the site and to take your booking.</p>
            </div>
            <span className="mt-0.5 text-xs font-medium text-zinc-400 flex-shrink-0">Always on</span>
          </div>

          {/* Marketing & analytics — toggle, default OFF */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-100 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-zinc-900">Marketing &amp; analytics</p>
              <p className="text-xs text-zinc-500">
                Lets us see where visitors come from and show the odd reminder. Off unless you switch it on.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={marketingOn}
              aria-label="Marketing and analytics cookies"
              onClick={() => setMarketingOn((v) => !v)}
              className={`mt-0.5 relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                marketingOn ? 'bg-zinc-900' : 'bg-zinc-200'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  marketingOn ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            onClick={() => applyConsent(marketingOn)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
          >
            Save choices
          </button>
          <button
            onClick={() => applyConsent(true)}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
          >
            Accept all
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-400">
          <a href={`/${locale}/privacy`} className="underline hover:text-zinc-600">
            Read our privacy &amp; cookie policy
          </a>
        </p>
      </div>
    </div>
  )
}
