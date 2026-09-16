import { describe, it, expect } from 'vitest'
import { computeInvoiceSuggestion } from './invoice-suggestion'

describe('computeInvoiceSuggestion', () => {
  it('computes base minus commission when an active percentage campaign exists', () => {
    const result = computeInvoiceSuggestion(10000, { percentage_value: 15, investment_type: 'percentage' })
    expect(result).toEqual({
      suggestedInvoiceCents: 8500,
      suggestedCommissionCents: 1500,
      hasCampaign: true,
      commissionPercent: 15,
    })
  })

  it('defaults to the full amount with no campaign', () => {
    const result = computeInvoiceSuggestion(10000, null)
    expect(result).toEqual({
      suggestedInvoiceCents: 10000,
      suggestedCommissionCents: 0,
      hasCampaign: false,
      commissionPercent: null,
    })
  })

  it('defaults to the full amount for a fixed_amount campaign (not a per-booking %)', () => {
    const result = computeInvoiceSuggestion(10000, { percentage_value: 500, investment_type: 'fixed_amount' })
    expect(result.hasCampaign).toBe(false)
    expect(result.suggestedInvoiceCents).toBe(10000)
  })

  it('defaults to the full amount when percentage_value is zero or missing', () => {
    expect(computeInvoiceSuggestion(10000, { percentage_value: 0, investment_type: 'percentage' }).hasCampaign).toBe(false)
    expect(computeInvoiceSuggestion(10000, { percentage_value: null, investment_type: 'percentage' }).hasCampaign).toBe(false)
  })

  it('rounds the commission to the nearest cent', () => {
    // 33.33% of 10001 cents = 3333.3333... cents
    const result = computeInvoiceSuggestion(10001, { percentage_value: 33.33, investment_type: 'percentage' })
    expect(result.suggestedCommissionCents).toBe(3333)
    expect(result.suggestedInvoiceCents).toBe(10001 - 3333)
  })
})

// The admin "Invoice later" wizard always asks for netBase, and the Stripe invoice
// deducts round(commission × 1.09) — these must match the /book route's own math.
describe('computeInvoiceSuggestion — commission over the net base (excl. 9% BTW)', () => {
  it('uses the partner rate when there is no campaign', () => {
    const result = computeInvoiceSuggestion(31000, null, { partnerCommissionRate: 20, commissionOnNetBaseOnly: true })
    expect(result).toEqual({
      suggestedInvoiceCents: 24800, // 31000 − round(5688 × 1.09)
      suggestedCommissionCents: 5688, // 20% of 28440
      hasCampaign: false,
      commissionPercent: 20,
      baseExVatCents: 28440,
    })
  })

  it('prefers an active campaign % over the partner rate', () => {
    const result = computeInvoiceSuggestion(
      31000,
      { percentage_value: 15, investment_type: 'percentage' },
      { partnerCommissionRate: 20, commissionOnNetBaseOnly: true },
    )
    expect(result.hasCampaign).toBe(true)
    expect(result.suggestedCommissionCents).toBe(4266) // 15% of 28440
  })
})
