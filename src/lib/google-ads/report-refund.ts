import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import { centsToMajor, formatConversionDateTime } from './conversion-value'
import { uploadConversionAdjustment } from './upload-adjustment'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Adjust a Google Ads conversion when its booking is refunded, so reported
 * revenue stays honest.
 *
 * Called from the Stripe webhook on `charge.refunded`.
 *  • Full refund  → RETRACTION (cancel the conversion)
 *  • Partial refund → RESTATEMENT (lower the value proportionally to the
 *    remaining charge)
 *
 * Guards:
 *  • No conversion row, or it never reached Google (status !== 'uploaded') →
 *    nothing to adjust.
 *  • Already retracted → no-op (later refund events for the same charge).
 *  • Never throws — failures are recorded on the row + logged.
 */
export async function reportRefundAdjustment(params: {
  supabase: AdminClient
  paymentIntentId: string
  isFullRefund: boolean
  refundedCents: number
  chargeAmountCents: number
}): Promise<void> {
  const { supabase, paymentIntentId, isFullRefund, refundedCents, chargeAmountCents } = params

  const { data: row, error } = await supabase
    .from('google_ads_conversions')
    .select('payment_intent_id, value_cents, status, adjustment_status')
    .eq('payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (error) {
    console.error('[google-ads] refund lookup failed for', paymentIntentId, error.message)
    return
  }
  if (!row || row.status !== 'uploaded') return // never reported → nothing to adjust
  if (row.adjustment_status === 'retracted') return // already fully retracted

  let restatementValueMajor: number | undefined
  if (!isFullRefund) {
    const remaining = chargeAmountCents > 0 ? (chargeAmountCents - refundedCents) / chargeAmountCents : 0
    restatementValueMajor = centsToMajor(Math.max(0, Math.round(row.value_cents * remaining)))
  }

  const result = await uploadConversionAdjustment({
    orderId: paymentIntentId,
    adjustmentType: isFullRefund ? 'RETRACTION' : 'RESTATEMENT',
    adjustmentDateTime: formatConversionDateTime(new Date()),
    restatementValueMajor,
    currencyCode: 'EUR',
  })

  await supabase
    .from('google_ads_conversions')
    .update({
      adjustment_status: result.ok ? (isFullRefund ? 'retracted' : 'restated') : 'adjustment_failed',
      adjusted_at: new Date().toISOString(),
      adjustment_response: (result.raw ?? null) as Json,
    })
    .eq('payment_intent_id', paymentIntentId)

  if (result.ok) {
    console.log(`[google-ads] conversion ${isFullRefund ? 'retracted' : 'restated'} for ${paymentIntentId}`)
  } else {
    console.error(`[google-ads] refund adjustment FAILED for ${paymentIntentId}:`, result.error ?? result.partialFailure)
  }
}
