'use client'

import Script from 'next/script'
import { useEffect } from 'react'
import { getCookie } from '@/lib/tracking/attribution'
import { COOKIE_CONSENT } from '@/lib/tracking/constants'

const ADS_TAG_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_TAG_ID

/**
 * Google Ads tag (gtag.js) with Consent Mode v2.
 *
 * Purpose: build remarketing audiences in Google Ads so we can retarget
 * visitors who browsed a cruise page but didn't book.
 *
 * No Google Analytics — we have our own first-party analytics.
 * No GTM — one tag, managed in code, no extra layer needed.
 *
 * Consent Mode v2:
 * - Visitors who accept cookies → full tracking signal (best for ad optimisation)
 * - Visitors who decline → anonymised modelled signals (~70-80% of value, GDPR-compliant)
 * - Without Consent Mode, declined visitors = zero signal to Google
 *
 * Flow:
 * 1. Set consent defaults to DENIED before the script loads (Google's requirement).
 * 2. Load gtag.js.
 * 3. On mount, check oc_consent cookie — if "yes", update to GRANTED immediately
 *    so returning visitors (who already accepted) get full tracking without waiting.
 * 4. CookieBanner calls window.ocUpdateConsent() in real time when user decides.
 */
export function GoogleTag() {
  if (!ADS_TAG_ID) return null

  return (
    <>
      {/*
        Consent Mode v2 defaults — must run synchronously BEFORE gtag.js loads.
        Everything denied until the user accepts the cookie banner.
      */}
      <Script
        id="gtag-consent-init"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('consent', 'default', {
              ad_storage:           'denied',
              analytics_storage:    'denied',
              ad_user_data:         'denied',
              ad_personalization:   'denied',
              wait_for_update:      500,
            });
            // Consent update helper — called by CookieBanner when user chooses
            window.ocUpdateConsent = function(granted) {
              var state = granted ? 'granted' : 'denied';
              gtag('consent', 'update', {
                ad_storage:           state,
                analytics_storage:    state,
                ad_user_data:         state,
                ad_personalization:   state,
              });
            };
          `,
        }}
      />

      {/* Google Ads tag — loads after consent defaults are set */}
      <Script
        id="gtag-script"
        src={`https://www.googletagmanager.com/gtag/js?id=${ADS_TAG_ID}`}
        strategy="afterInteractive"
      />

      {/* Configure the tag — no page_view events, just remarketing audiences */}
      <Script
        id="gtag-config"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${ADS_TAG_ID}', {
              send_page_view: false,
            });
          `,
        }}
      />

      <ConsentInitializer />
    </>
  )
}

/**
 * Reads the existing oc_consent cookie on page load and fires the consent update
 * so returning visitors (who already accepted) get full tracking immediately.
 */
function ConsentInitializer() {
  useEffect(() => {
    const consent = getCookie(COOKIE_CONSENT)
    if (consent === 'yes' && typeof window !== 'undefined' && window.ocUpdateConsent) {
      window.ocUpdateConsent(true)
    }
  }, [])
  return null
}

declare global {
  interface Window {
    ocUpdateConsent?: (granted: boolean) => void
  }
}
