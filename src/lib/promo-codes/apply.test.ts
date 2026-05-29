import { describe, it, expect } from 'vitest'
import { applyPromoCode } from './apply'
import type { PromoCodeRow } from './validate'

// ── Test helper ─────────────────────────────────────────────────────────────

function makeCode(overrides: Partial<PromoCodeRow> = {}): PromoCodeRow {
  return {
    id: 'test-id',
    code: 'TEST',
    label: 'Test',
    discount_type: 'percentage',
    discount_value: 10,
    fixed_discount_cents: null,
    max_uses: null,
    uses_count: 0,
    valid_from: null,
    valid_until: null,
    is_active: true,
    campaign_id: null,
    discount_scope: 'cruise',
    ...overrides,
  }
}

// ── isFull semantics ────────────────────────────────────────────────────────
// isFull means "customer pays €0 — bypass Stripe". It's based on newTotalCents,
// NOT on discount_type alone. A 100%-off code with scope='cruise' and extras
// still leaves extras to charge → isFull MUST be false.

describe('applyPromoCode — isFull semantics', () => {
  it('100%-off + scope=cruise + extras still owed → isFull=false (Stripe charges extras)', () => {
    const code = makeCode({ discount_type: 'full', discount_scope: 'cruise' })
    // WeBikeAmsterdam: cruise+citytax = 11280, drinks = 4500, grand = 15780
    const r = applyPromoCode(code, 15780, 11280)
    expect(r.discountAmountCents).toBe(11280)
    expect(r.newTotalCents).toBe(4500)
    expect(r.isFull).toBe(false)
  })

  it('100%-off + no extras → isFull=true (bypass Stripe)', () => {
    const code = makeCode({ discount_type: 'full' })
    const r = applyPromoCode(code, 11280, 11280)
    expect(r.discountAmountCents).toBe(11280)
    expect(r.newTotalCents).toBe(0)
    expect(r.isFull).toBe(true)
  })

  it('100%-off + scope=all + extras → isFull=true (bypass Stripe, everything covered)', () => {
    const code = makeCode({ discount_type: 'full', discount_scope: 'all' })
    // No discountableBase passed → applies to grandTotal
    const r = applyPromoCode(code, 15780)
    expect(r.discountAmountCents).toBe(15780)
    expect(r.newTotalCents).toBe(0)
    expect(r.isFull).toBe(true)
  })

  it('percentage discount → isFull=false', () => {
    const code = makeCode({ discount_type: 'percentage', discount_value: 20 })
    const r = applyPromoCode(code, 10000)
    expect(r.discountAmountCents).toBe(2000)
    expect(r.newTotalCents).toBe(8000)
    expect(r.isFull).toBe(false)
  })

  it('fixed_amount discount covering full total → isFull=true', () => {
    const code = makeCode({
      discount_type: 'fixed_amount',
      fixed_discount_cents: 10000,
    })
    const r = applyPromoCode(code, 10000)
    expect(r.newTotalCents).toBe(0)
    expect(r.isFull).toBe(true)
  })
})

// ── discountable base behavior ──────────────────────────────────────────────

describe('applyPromoCode — discountableBaseCents', () => {
  it('defaults to grandTotal when not provided (legacy back-compat)', () => {
    const code = makeCode({ discount_type: 'percentage', discount_value: 50 })
    const r = applyPromoCode(code, 10000)
    expect(r.discountAmountCents).toBe(5000)
  })

  it('percentage discount applies to the discountable base only', () => {
    const code = makeCode({ discount_type: 'percentage', discount_value: 50 })
    // 50% off cruise (€100) only; extras (€50) untouched. Grand total €150.
    const r = applyPromoCode(code, 15000, 10000)
    expect(r.discountAmountCents).toBe(5000) // 50% of 10000
    expect(r.newTotalCents).toBe(10000)      // 15000 - 5000
  })

  it('fixed amount is capped at the discountable base', () => {
    const code = makeCode({
      discount_type: 'fixed_amount',
      fixed_discount_cents: 20000,  // €200 off
    })
    // But discountable base is only €100 → discount capped at €100
    const r = applyPromoCode(code, 15000, 10000)
    expect(r.discountAmountCents).toBe(10000)
    expect(r.newTotalCents).toBe(5000)
  })

  it('discountable base never exceeds the grand total', () => {
    const code = makeCode({ discount_type: 'full' })
    // Caller mistakenly passes a base larger than grandTotal — should be clamped.
    const r = applyPromoCode(code, 5000, 99999)
    expect(r.discountAmountCents).toBe(5000)
    expect(r.newTotalCents).toBe(0)
  })
})
