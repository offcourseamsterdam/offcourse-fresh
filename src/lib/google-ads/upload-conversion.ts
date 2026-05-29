import { getConfig, googleAdsPost, type GoogleAdsResult } from './client'
import type { UserIdentifier } from './user-identifiers'
import type { ClickType } from '@/lib/tracking/click-ids'

// Google Ads Offline Conversion Import — report a paid booking as a conversion.
// All transport (auth, version, timeout, errors) lives in ./client.

export interface UploadConversionInput {
  /** The click id value (a gclid, wbraid, or gbraid). */
  clickId: string
  /** Which field the click id belongs in — iOS ids don't match as gclid. */
  clickType: ClickType
  /** Major currency units (e.g. 165.00, not cents). */
  conversionValue: number
  /** ISO 4217, upper-case (e.g. 'EUR'). */
  currencyCode: string
  /** Google format: 'yyyy-mm-dd hh:mm:ss+hh:mm'. */
  conversionDateTime: string
  /** Dedupe key on Google's side too — we pass the Stripe PaymentIntent id. */
  orderId: string
  /** Enhanced conversions: hashed first-party identifiers. Consent-gated by the caller. */
  userIdentifiers?: UserIdentifier[]
}

export async function uploadClickConversion(input: UploadConversionInput): Promise<GoogleAdsResult> {
  const cfg = getConfig()
  if ('error' in cfg) return { ok: false, status: 0, error: cfg.error }

  const conversion: Record<string, unknown> = {
    [input.clickType]: input.clickId, // gclid | wbraid | gbraid
    conversionAction: cfg.conversionAction,
    conversionDateTime: input.conversionDateTime,
    conversionValue: input.conversionValue,
    currencyCode: input.currencyCode,
    orderId: input.orderId,
  }
  if (input.userIdentifiers && input.userIdentifiers.length > 0) {
    conversion.userIdentifiers = input.userIdentifiers
  }

  return googleAdsPost(cfg, 'uploadClickConversions', {
    conversions: [conversion],
    partialFailure: true,
  })
}
