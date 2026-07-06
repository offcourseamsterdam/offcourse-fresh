import { describe, it, expect } from 'vitest'
import { computeInvoiceSuggestion, commissionFromInvoiceAmount } from './invoice-suggestion'

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

describe('commissionFromInvoiceAmount', () => {
  it('derives the commission as base minus the chosen invoice amount', () => {
    expect(commissionFromInvoiceAmount(10000, 8500)).toBe(1500)
  })

  it('never goes negative when the admin invoices more than the base amount', () => {
    expect(commissionFromInvoiceAmount(10000, 12000)).toBe(0)
  })

  it('is zero when invoicing the full amount', () => {
    expect(commissionFromInvoiceAmount(10000, 10000)).toBe(0)
  })
})
