import { describe, it, expect } from 'vitest'
import {
  classifyByLearnedRules,
  classifyDeterministic,
  classifyStructural,
  matchesStaffName,
  type ClassifiableTransaction,
  type LearnedRule,
  type RuleContext,
} from './rules'

// Names, amounts and shapes below are taken from the real Revolut feed pulled
// on 2026-09-04, so the rules are tested against what actually arrives.

const TODAY = '2026-09-04'

const tx = (o: Partial<ClassifiableTransaction>): ClassifiableTransaction => ({
  id: 't1',
  revolutId: 'rev-1',
  type: 'transfer',
  state: 'completed',
  amountCents: -10000,
  feeCents: 0,
  createdAt: '2026-09-01T10:00:00Z',
  reference: null,
  description: null,
  counterpartyName: null,
  counterpartyAccountType: null,
  merchantName: null,
  merchantCategoryCode: null,
  ...o,
})

const ctx = (o: Partial<RuleContext> = {}): RuleContext => ({
  today: TODAY,
  staff: [
    { id: 's1', name: 'Beer Zoomers', role: 'owner' },
    { id: 's2', name: 'Jannah Schenk', role: 'skipper' },
    { id: 's3', name: 'Mare Roorda', role: 'skipper' },
    { id: 's4', name: 'Bo', role: 'skipper' },
  ],
  loanPayments: [],
  obligations: [],
  learnedRules: [],
  ...o,
})

describe('matchesStaffName', () => {
  it('needs both parts of a two-word name', () => {
    expect(matchesStaffName('to jannah schenk', 'Jannah Schenk')).toBe(true)
    expect(matchesStaffName('to jannah de vries', 'Jannah Schenk')).toBe(false)
  })
  it('a short single-word name must stand as its own word, so Marqt is not Mare', () => {
    expect(matchesStaffName('marqt amsterdam', 'Mare')).toBe(false)
    expect(matchesStaffName('marinaio', 'Mare')).toBe(false)
    expect(matchesStaffName('to mare', 'Mare')).toBe(true)
    expect(matchesStaffName('betaling aan bo', 'Bo')).toBe(true)
    expect(matchesStaffName('boatlocal payout', 'Bo')).toBe(false)
  })
})

describe('classifyStructural — income', () => {
  it('recognises every payout channel we reconcile', () => {
    for (const [name, label] of [
      ['Payment from Stripe', 'Stripe'],
      ['Payment from Getyourguide Deutsch', 'GetYourGuide'],
      ['Payment from Viator Limited', 'Viator'],
      ['Payment from Boat Local', 'Boat Local'],
    ] as const) {
      const c = classifyStructural(tx({ amountCents: 250000, description: name }), ctx())
      expect(c).toMatchObject({ category: 'income', subcategory: 'booking', confidence: 1 })
      expect(c?.reason).toContain(label)
    }
  })

  it('treats a processor payout as booking revenue with slightly lower confidence', () => {
    const c = classifyStructural(tx({ amountCents: 91000, description: 'Payment from Paypal Pte. Ltd.' }), ctx())
    expect(c).toMatchObject({ category: 'income', subcategory: 'booking' })
    expect(c!.confidence).toBeLessThan(1)
  })

  it('does not turn an outgoing payment to Stripe into income', () => {
    expect(classifyStructural(tx({ amountCents: -5000, description: 'To Stripe' }), ctx())?.category).not.toBe('income')
  })
})

describe('classifyStructural — people', () => {
  it('a skipper payment is crew cost', () => {
    const c = classifyStructural(tx({ amountCents: -217800, description: 'To Mare Roorda' }), ctx())
    expect(c).toMatchObject({ category: 'operating', subcategory: 'crew' })
    expect(c?.reason).toContain('Mare Roorda')
  })
  it('a payment to the owner is owner salary, not crew', () => {
    expect(classifyStructural(tx({ amountCents: -200000, description: 'To Beer Zoomers' }), ctx()))
      .toMatchObject({ category: 'owner', subcategory: 'salary' })
  })
  it('money coming in from a staff member is not classified as a wage', () => {
    expect(classifyStructural(tx({ amountCents: 5000, description: 'Payment from Beer Zoomers' }), ctx())?.category)
      .not.toBe('owner')
  })
})

describe('classifyStructural — suppliers', () => {
  it.each([
    ['To Jachthaven westerdok marina', 'operating', 'mooring'],
    ['E.O.C. Onderl. Schepenverz. U.A.', 'operating', 'insurance'],
    ['Taste Vin B.V.', 'operating', 'catering'],
    ['Drankengilde B.V.', 'operating', 'catering'],
    ['Marqt', 'operating', 'catering'],
    ['FareHarbor B.V.', 'operating', 'software'],
    ['Anthropic', 'operating', 'software'],
    ['Supabase', 'operating', 'software'],
    ['Snelstart Software', 'operating', 'software'],
    ['Belastingdienst', 'tax', 'vat'],
  ])('%s → %s/%s', (name, category, subcategory) => {
    expect(classifyStructural(tx({ amountCents: -5000, merchantName: name }), ctx()))
      .toMatchObject({ category, subcategory })
  })

  it('the most specific supplier pattern wins, so Google Ads is marketing not software', () => {
    expect(classifyStructural(tx({ amountCents: -25000, merchantName: 'Google Ads' }), ctx()))
      .toMatchObject({ category: 'operating', subcategory: 'marketing' })
    expect(classifyStructural(tx({ amountCents: -1200, merchantName: 'Google Cloud' }), ctx()))
      .toMatchObject({ category: 'operating', subcategory: 'software' })
  })

  it('Taste Vin paying us is income, not a catering cost', () => {
    const c = classifyStructural(tx({ amountCents: 154300, description: 'Payment from Taste Vin B.v.' }), ctx())
    expect(c?.category).not.toBe('operating')
  })
})

describe('classifyStructural — fees and internal transfers', () => {
  it('a Revolut fee is a bank cost', () => {
    expect(classifyStructural(tx({ type: 'fee', amountCents: -250 }), ctx()))
      .toMatchObject({ category: 'operating', subcategory: 'fees' })
  })
  it('a transfer to our own account is internal, never a cost', () => {
    expect(classifyStructural(tx({ amountCents: -100000, counterpartyAccountType: 'self' }), ctx()))
      .toMatchObject({ category: 'transfer', subcategory: 'internal' })
    expect(classifyStructural(tx({ amountCents: -100000, description: 'To Off Course Savings' }), ctx({ ownAccountNames: ['Off Course Savings'] })))
      .toMatchObject({ category: 'transfer' })
  })
})

describe('classifyStructural — loan payments', () => {
  const loanPayments = [{
    id: 'p1', loanId: 'l1', loanName: 'Lening Tijs Louman', lenderName: 'Tijs Louman',
    dueDate: '2026-10-01', totalCents: 18000, isPaid: false,
  }]

  it('links a payment on the scheduled date for the scheduled amount', () => {
    const c = classifyStructural(
      tx({ amountCents: -18000, createdAt: '2026-10-01T09:00:00Z', description: 'To Tijs Louman' }),
      ctx({ loanPayments }),
    )
    expect(c).toMatchObject({ category: 'financing', loanPaymentId: 'p1' })
  })

  it('accepts a few days of slack around the due date but not a different month', () => {
    const near = classifyStructural(tx({ amountCents: -18000, createdAt: '2026-10-04T09:00:00Z', description: 'To Tijs Louman' }), ctx({ loanPayments }))
    expect(near?.loanPaymentId).toBe('p1')
    const far = classifyStructural(tx({ amountCents: -18000, createdAt: '2026-11-01T09:00:00Z', description: 'To Tijs Louman' }), ctx({ loanPayments }))
    expect(far?.loanPaymentId).toBeUndefined()
  })

  it('refuses to link when the amount is different', () => {
    const c = classifyStructural(tx({ amountCents: -50000, createdAt: '2026-10-01T09:00:00Z', description: 'To Tijs Louman' }), ctx({ loanPayments }))
    expect(c?.loanPaymentId).toBeUndefined()
  })

  it('never links a payment that is already marked paid', () => {
    const c = classifyStructural(
      tx({ amountCents: -18000, createdAt: '2026-10-01T09:00:00Z', description: 'To Tijs Louman' }),
      ctx({ loanPayments: [{ ...loanPayments[0], isPaid: true }] }),
    )
    expect(c?.loanPaymentId).toBeUndefined()
  })
})

describe('classifyStructural — obligations', () => {
  const obligations = [{ id: 'o1', title: 'BTW Q3', kind: 'tax', amountCents: 680000, dueDate: '2026-10-31', status: 'open' }]

  it('links a matching amount inside the window', () => {
    const c = classifyStructural(tx({ amountCents: -680000, createdAt: '2026-10-30T09:00:00Z', merchantName: 'Onbekend' }), ctx({ obligations }))
    expect(c).toMatchObject({ category: 'tax', obligationId: 'o1' })
  })
  it('ignores an obligation that is no longer open', () => {
    const c = classifyStructural(tx({ amountCents: -680000, createdAt: '2026-10-30T09:00:00Z' }), ctx({ obligations: [{ ...obligations[0], status: 'paid' }] }))
    expect(c).toBeNull()
  })
})

describe('classifyByLearnedRules', () => {
  const rule = (o: Partial<LearnedRule>): LearnedRule => ({
    id: 'r1', matchField: 'merchant_name', pattern: 'janaki', direction: 'any',
    category: 'operating', subcategory: 'marketing', boatId: null, goalId: null,
    priority: 100, isActive: true, ...o,
  })

  it('matches case-insensitively on the chosen field only', () => {
    const t = tx({ amountCents: -82700, merchantName: 'Janaki.design', description: 'iets anders' })
    expect(classifyByLearnedRules(t, [rule({})])).toMatchObject({ category: 'operating', subcategory: 'marketing', ruleId: 'r1', confidence: 1 })
    expect(classifyByLearnedRules(t, [rule({ matchField: 'reference' })])).toBeNull()
  })

  it('respects direction, so one name can be a customer and a supplier', () => {
    const incoming = tx({ amountCents: 154300, description: 'Payment from Taste Vin B.v.' })
    const outgoing = tx({ amountCents: -20000, description: 'Taste Vin B.V.' })
    const rules = [
      rule({ id: 'in', matchField: 'description', pattern: 'taste vin', direction: 'in', category: 'income', subcategory: 'booking' }),
      rule({ id: 'out', matchField: 'description', pattern: 'taste vin', direction: 'out', category: 'operating', subcategory: 'catering' }),
    ]
    expect(classifyByLearnedRules(incoming, rules)?.ruleId).toBe('in')
    expect(classifyByLearnedRules(outgoing, rules)?.ruleId).toBe('out')
  })

  it('ignores inactive rules and rules whose category contradicts the sign', () => {
    const t = tx({ amountCents: -5000, merchantName: 'Janaki.design' })
    expect(classifyByLearnedRules(t, [rule({ isActive: false })])).toBeNull()
    expect(classifyByLearnedRules(t, [rule({ category: 'income' })])).toBeNull()
  })

  it('highest priority wins, then the most specific pattern', () => {
    const t = tx({ amountCents: -5000, merchantName: 'Amazon EU SARL' })
    const chosen = classifyByLearnedRules(t, [
      rule({ id: 'broad', pattern: 'amazon', subcategory: 'other', priority: 100 }),
      rule({ id: 'specific', pattern: 'amazon eu', subcategory: 'equipment', category: 'upgrade', priority: 100 }),
    ])
    expect(chosen?.ruleId).toBe('specific')
    const overridden = classifyByLearnedRules(t, [
      rule({ id: 'broad', pattern: 'amazon', subcategory: 'other', priority: 500 }),
      rule({ id: 'specific', pattern: 'amazon eu', subcategory: 'equipment', category: 'upgrade', priority: 100 }),
    ])
    expect(overridden?.ruleId).toBe('broad')
  })
})

describe('classifyDeterministic — layer order', () => {
  const learned: LearnedRule = {
    id: 'r-crew', matchField: 'description', pattern: 'marqt', direction: 'out',
    category: 'operating', subcategory: 'other', boatId: null, goalId: null,
    priority: 100, isActive: true,
  }

  it('a learned rule overrides a built-in supplier guess', () => {
    const t = tx({ amountCents: -1200, description: 'Marqt', merchantName: 'Marqt' })
    expect(classifyStructural(t, ctx())?.subcategory).toBe('catering')
    expect(classifyDeterministic(t, ctx({ learnedRules: [learned] }))).toMatchObject({ subcategory: 'other', ruleId: 'r-crew' })
  })

  it('but a proven link (loan payment, obligation, internal transfer) always wins', () => {
    const loanPayments = [{ id: 'p1', loanId: 'l1', loanName: 'Lening X', lenderName: 'Marqt Holding', dueDate: '2026-10-01', totalCents: 1200, isPaid: false }]
    const t = tx({ amountCents: -1200, createdAt: '2026-10-01T09:00:00Z', description: 'Marqt Holding' })
    const c = classifyDeterministic(t, ctx({ learnedRules: [learned], loanPayments }))
    expect(c?.loanPaymentId).toBe('p1')
  })

  it('returns null when nothing matches, so the caller can ask the AI', () => {
    expect(classifyDeterministic(tx({ amountCents: -4200, description: 'To Marinaio' }), ctx())).toBeNull()
  })
})
