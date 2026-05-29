import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import type Stripe from 'stripe'
import { centsToMajor, computeNetRevenueCents, decideUpload, formatConversionDateTime } from './conversion-value'
import { uploadClickConversion } from './upload-conversion'
import { buildUserIdentifiers } from './user-identifiers'
import { toClickType } from '@/lib/tracking/click-ids'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Report a paid booking to Google Ads (Offline Conversion Import).
 *
 * Called from the Stripe webhook for EVERY successful payment, *before* the
 * booking-creation idempotency check (which early-returns for card payments
 * already handled by /book) — so this is the one reliable once-per-payment hook.
 *
 * Safety properties:
 *  • Dedupe — claims the PaymentIntent in `google_ads_conversions`; a re-delivered
 *    webhook or a racing /book call is a no-op.
 *  • Consent — gated by GOOGLE_ADS_REQUIRE_CONSENT (default on); a skip still logs
 *    a row so we have a full audit trail.
 *  • Never throws — every failure is recorded on the row + logged; the webhook's
 *    booking flow is never affected.
 */
export async function reportBookingConversion(params: {
  supabase: AdminClient
  pi: Stripe.PaymentIntent
}): Promise<void> {
  const { supabase, pi } = params
  const meta = (pi.metadata ?? {}) as Record<string, string | undefined>

  const gclid = (meta.gclid ?? '').trim()
  const clickType = toClickType(meta.click_type)
  const consent = meta.consent_marketing ?? null
  const requireConsent = process.env.GOOGLE_ADS_REQUIRE_CONSENT !== 'false' // default true
  const valueCents = computeNetRevenueCents(meta)
  const decision = decideUpload({ gclid, consent, requireConsent })

  // Dedupe + claim. ON CONFLICT DO NOTHING → empty result means already handled.
  const { data: claimed, error: claimError } = await supabase
    .from('google_ads_conversions')
    .upsert(
      {
        payment_intent_id: pi.id,
        gclid: gclid || null,
        value_cents: valueCents,
        currency: 'eur',
        consent_marketing: consent === 'yes',
        status: decision.send ? 'pending' : decision.reason,
      },
      { onConflict: 'payment_intent_id', ignoreDuplicates: true },
    )
    .select('payment_intent_id')

  if (claimError) {
    console.error('[google-ads] dedupe insert failed for', pi.id, claimError.message)
    return
  }
  if (!claimed || claimed.length === 0) return // already processed by a prior delivery

  if (!decision.send) {
    console.log(`[google-ads] ${pi.id}: ${decision.reason} — not sent to Google`)
    return
  }

  const result = await uploadClickConversion({
    clickId: gclid,
    clickType,
    conversionValue: centsToMajor(valueCents),
    currencyCode: 'EUR',
    conversionDateTime: formatConversionDateTime(new Date(pi.created * 1000)),
    orderId: pi.id,
    // Enhanced conversions: hashed email/phone improve match rates (cross-device,
    // expired cookies, iOS). Attached ONLY with explicit consent — independent of
    // GOOGLE_ADS_REQUIRE_CONSENT — so customer PII never leaves without it.
    userIdentifiers:
      consent === 'yes'
        ? buildUserIdentifiers({ email: meta.guest_email, phone: meta.guest_phone })
        : undefined,
  })

  await supabase
    .from('google_ads_conversions')
    .update({
      status: result.ok ? 'uploaded' : 'failed',
      uploaded_at: new Date().toISOString(),
      google_response: (result.raw ?? null) as Json,
      error: result.ok ? null : (result.error ?? result.partialFailure ?? 'unknown error'),
    })
    .eq('payment_intent_id', pi.id)

  if (result.ok) {
    console.log(`[google-ads] conversion uploaded for ${pi.id} (€${centsToMajor(valueCents)} net)`)
  } else {
    console.error(`[google-ads] conversion upload FAILED for ${pi.id}:`, result.error ?? result.partialFailure)
  }
}
