'use client'

import Script from 'next/script'
import { useEffect } from 'react'
import { getCookie } from '@/lib/tracking/attribution'
import { COOKIE_CONSENT } from '@/lib/tracking/constants'

const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID?.trim() || null

/**
 * Microsoft Clarity — session recordings + heatmaps for offcourseamsterdam.com.
 *
 * Purpose: see what visitors actually do on the site (where they scroll, click,
 * rage-click, drop off) — separate concern from GoogleTag's remarketing signal.
 *
 * This project has no Clarity project ID wired up yet. Creating the Clarity
 * PROJECT itself (clarity.microsoft.com, signed in with Beer's Microsoft account)
 * is a Beer-only step — set NEXT_PUBLIC_CLARITY_PROJECT_ID once that exists and
 * this component activates with no further code changes.
 *
 * The install snippet below follows Microsoft's standard documented format
 * (stable for years); double-check it against the exact snippet shown on the
 * new project's own Settings → Setup → Install manually page before relying on
 * it in case Microsoft has tweaked it since.
 *
 * Consent: uses Clarity's consentv2 API, same oc_consent cookie and real-time
 * update path as GoogleTag (see ocUpdateConsent in GoogleTag.tsx, extended
 * there to also notify Clarity when window.clarity is present).
 */
export function ClarityTag() {
  if (!CLARITY_PROJECT_ID) return null

  return (
    <>
      <Script
        id="clarity-script"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function(c,l,a,r,i,t,y){
                c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");
            window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' });
          `,
        }}
      />
      <ClarityConsentInitializer />
    </>
  )
}

/**
 * Mirrors GoogleTag's ConsentInitializer — reads the existing oc_consent cookie
 * on mount so returning visitors who already accepted get full tracking
 * immediately, without waiting for another banner interaction.
 */
function ClarityConsentInitializer() {
  useEffect(() => {
    const consent = getCookie(COOKIE_CONSENT)
    if (consent === 'yes' && typeof window !== 'undefined' && window.clarity) {
      window.clarity('consentv2', { ad_Storage: 'granted', analytics_Storage: 'granted' })
    }
  }, [])
  return null
}

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void
  }
}
