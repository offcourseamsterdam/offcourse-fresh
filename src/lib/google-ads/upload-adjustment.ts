import { getConfig, googleAdsPost, type GoogleAdsResult } from './client'

// Google Ads Conversion Adjustment — used on refunds:
//  • RETRACTION  → cancel the conversion (full refund)
//  • RESTATEMENT → lower the conversion value (partial refund)
// The conversion is matched by orderId (the Stripe PaymentIntent id we uploaded
// it with), so no gclid is needed here.

export interface AdjustmentInput {
  orderId: string
  adjustmentType: 'RETRACTION' | 'RESTATEMENT'
  /** Google format 'yyyy-mm-dd hh:mm:ss+hh:mm'; must be after the conversion time. */
  adjustmentDateTime: string
  /** New conversion value in major units — required for RESTATEMENT only. */
  restatementValueMajor?: number
  currencyCode: string
}

export async function uploadConversionAdjustment(input: AdjustmentInput): Promise<GoogleAdsResult> {
  const cfg = getConfig()
  if ('error' in cfg) return { ok: false, status: 0, error: cfg.error }

  const adjustment: Record<string, unknown> = {
    conversionAction: cfg.conversionAction,
    adjustmentType: input.adjustmentType,
    orderId: input.orderId,
    adjustmentDateTime: input.adjustmentDateTime,
  }
  if (input.adjustmentType === 'RESTATEMENT' && input.restatementValueMajor != null) {
    adjustment.restatementValue = {
      adjustedValue: input.restatementValueMajor,
      currencyCode: input.currencyCode,
    }
  }

  return googleAdsPost(cfg, 'uploadConversionAdjustments', {
    conversionAdjustments: [adjustment],
    partialFailure: true,
  })
}
