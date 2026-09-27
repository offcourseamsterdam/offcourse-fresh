import { describe, it, expect } from 'vitest'
import { classifyByHistory, examplesFor, historyKey, type PastClassification } from './history'
import type { ClassifiableTransaction } from './rules'

const tx = (over: Partial<ClassifiableTransaction> = {}): ClassifiableTransaction => ({
  id: 'new',
  revolutId: 'r-new',
  type: 'transfer',
  state: 'completed',
  amountCents: -4500,
  feeCents: 0,
  createdAt: '2026-09-20T10:00:00Z',
  reference: null,
  description: 'To Havenbedrijf',
  counterpartyName: null,
  counterpartyId: 'cp-haven',
  counterpartyAccountType: 'business',
  merchantName: null,
  merchantCategoryCode: null,
  ...over,
})

const past = (over: Partial<PastClassification> = {}): PastClassification => ({
  key: 'cp:cp-haven',
  amountCents: -4200,
  category: 'operating',
  subcategory: 'mooring',
  boatId: null,
  goalId: null,
  obligationId: null,
  loanPaymentId: null,
  label: 'To Havenbedrijf',
  reviewedAt: '2026-08-01T10:00:00Z',
  ...over,
})

describe('historyKey', () => {
  it('uses the Revolut counterparty id for transfers — the name is never sent', () => {
    expect(historyKey(tx())).toBe('cp:cp-haven')
  })
  it('uses the merchant name for card payments', () => {
    expect(historyKey(tx({ counterpartyId: null, merchantName: 'Albert  Heijn' }))).toBe('m:albert heijn')
  })
  it('falls back to the description (top-ups, charges)', () => {
    expect(historyKey(tx({ counterpartyId: null, description: 'Top-Up by *1234' }))).toBe('d:top-up by *1234')
  })
})

describe('classifyByHistory', () => {
  it('files it like the last times when Beer always did the same', () => {
    const result = classifyByHistory(tx(), [past(), past({ amountCents: -4600, reviewedAt: '2026-09-01T10:00:00Z' })])
    expect(result).toMatchObject({ category: 'operating', subcategory: 'mooring', source: 'rule', confidence: 1 })
    expect(result?.reason).toContain('vorige 2 keer')
  })

  it('needs at least two precedents — one decision is not a pattern yet', () => {
    expect(classifyByHistory(tx(), [past()])).toBeNull()
  })

  it('stays out when Beer filed this counterparty in different ways', () => {
    expect(classifyByHistory(tx(), [past(), past({ subcategory: 'fuel' })])).toBeNull()
  })

  it('stays out when the boat differed between precedents', () => {
    expect(classifyByHistory(tx(), [past({ boatId: 'diana' }), past({ boatId: 'curacao' })])).toBeNull()
  })

  it('only compares the same direction of money — a refund from a supplier is not a payment to it', () => {
    const refund = tx({ amountCents: 4500 })
    expect(classifyByHistory(refund, [past(), past()])).toBeNull()
  })

  it('never copies a goal, obligation or loan-payment link', () => {
    expect(classifyByHistory(tx(), [past({ loanPaymentId: 'lp-1' }), past()])).toBeNull()
    expect(classifyByHistory(tx(), [past({ goalId: 'g-1' }), past({ goalId: 'g-1' })])).toBeNull()
  })

  it('sends an unusual amount to the AI and a human instead', () => {
    expect(classifyByHistory(tx({ amountCents: -200000 }), [past(), past()])).toBeNull()
    expect(classifyByHistory(tx({ amountCents: -100 }), [past(), past()])).toBeNull()
  })

  it('ignores precedents for other counterparties', () => {
    expect(classifyByHistory(tx(), [past({ key: 'cp:someone-else' }), past({ key: 'cp:someone-else' })])).toBeNull()
  })
})

describe('examplesFor', () => {
  it("puts this counterparty's own precedents first, then recent others", () => {
    const own = past({ label: 'own', reviewedAt: '2026-06-01T00:00:00Z' })
    const recentOther = past({ key: 'cp:other', label: 'recent other', reviewedAt: '2026-09-10T00:00:00Z' })
    const examples = examplesFor(tx(), [recentOther, own], 5)
    expect(examples.map(e => e.label)).toEqual(['own', 'recent other'])
  })
})
