import { describe, it, expect } from 'vitest'
import { decideMatch, rankCandidates, scoreMatch, type MatchDocument, type MatchExpense } from './match'

const invoice = (over: Partial<MatchDocument> = {}, extracted: Partial<MatchDocument['extracted']> = {}): MatchDocument => ({
  id: 'doc-1', kind: 'invoice_pdf', createdAt: '2026-09-08T09:00:00Z',
  extracted: { supplierName: 'bol.com b.v.', invoiceNumber: 'INV-2026-12345', orderNumber: '12345', invoiceDate: '2026-09-08', grossCents: 12100, vatCents: 2100, currency: 'EUR', ...extracted },
  ...over,
})
const payment = (over: Partial<MatchExpense> = {}): MatchExpense => ({
  id: 'exp-bol', cashOutCents: 12100, paidAt: '2026-09-05T12:00:00Z', supplierName: 'BOL.COM BV', bankReference: null, bankDescription: 'BOL.COM BV AMSTERDAM', counterpartyIban: null, currency: 'EUR', ...over,
})

describe('scoreMatch — the PRD bol.com purchase', () => {
  it('exact amount + same merchant + invoice 3 days after the card payment is an automatic match', () => {
    const m = scoreMatch(invoice(), payment())
    expect(m.signals).toMatchObject({ exactAmount: true, supplierName: 1, dateProximity: true, currencyOk: true })
    expect(m.score).toBeGreaterThanOrEqual(0.9)
  })

  it('the order number appearing in the bank description adds evidence', () => {
    const with_ = scoreMatch(invoice(), payment({ bankDescription: 'BOL.COM order 12345' }))
    const without = scoreMatch(invoice(), payment())
    expect(with_.signals.numberInReference).toBe(true)
    expect(with_.score).toBeGreaterThan(without.score)
  })

  it('the same €121 to a different merchant is NOT a match on amount alone', () => {
    const m = scoreMatch(invoice(), payment({ id: 'exp-coolblue', supplierName: 'Coolblue', bankDescription: 'COOLBLUE BV' }))
    expect(m.signals.exactAmount).toBe(true)
    expect(m.signals.supplierName).toBe(0)
    expect(m.score).toBeLessThan(0.9)
  })

  it('a different amount for the same merchant is a weak candidate at best', () => {
    const m = scoreMatch(invoice({}, { grossCents: 8900 }), payment())
    expect(m.signals.exactAmount).toBe(false)
    expect(m.signals.amountWithin).toBe(false)
    expect(m.score).toBeLessThan(0.6)
  })

  it('a card-fee rounding difference still counts, a little less', () => {
    const m = scoreMatch(invoice({}, { grossCents: 12150 }), payment())
    expect(m.signals).toMatchObject({ exactAmount: false, amountWithin: true })
    expect(m.score).toBeLessThan(scoreMatch(invoice(), payment()).score)
  })

  it('a currency mismatch is a hard zero', () => {
    expect(scoreMatch(invoice({}, { currency: 'USD' }), payment()).score).toBe(0)
  })

  it('an invoice dated a month after the payment falls outside the window', () => {
    const m = scoreMatch(invoice({}, { invoiceDate: '2026-10-20' }), payment())
    expect(m.signals.dateProximity).toBe(false)
  })

  it('an IBAN match (a transfer, not a card) is strong evidence', () => {
    const m = scoreMatch(invoice({}, { iban: 'NL91 ABNA 0417 1643 00', supplierName: null, grossCents: null }), payment({ counterpartyIban: 'NL91ABNA0417164300', supplierName: null, cashOutCents: null }))
    expect(m.signals.ibanMatch).toBe(true)
  })
})

describe('scoreMatch — order confirmation window', () => {
  it('an order mail the day before the card payment is in window; a week before is not', () => {
    const doc = invoice({ kind: 'order_confirmation_email', createdAt: '2026-09-04T18:00:00Z' }, { invoiceDate: null, invoiceNumber: null })
    expect(scoreMatch(doc, payment()).signals.dateProximity).toBe(true)
    expect(scoreMatch({ ...doc, createdAt: '2026-08-28T18:00:00Z' }, payment()).signals.dateProximity).toBe(false)
  })
})

describe('rankCandidates + decideMatch', () => {
  it('the ice-cream receipt: exact amount + same shop + same day → auto', () => {
    const receipt = invoice({ kind: 'revolut_receipt', createdAt: '2026-09-05T15:00:00Z' }, { supplierName: 'Supermarkt X', invoiceNumber: null, orderNumber: null, invoiceDate: '2026-09-05', grossCents: 2420, vatCents: 420 })
    const ranked = rankCandidates(receipt, [payment({ id: 'ice', cashOutCents: 2420, supplierName: 'Supermarkt X', bankDescription: 'SUPERMARKT X' }), payment()])
    expect(ranked[0].expense.id).toBe('ice')
    expect(decideMatch(ranked).kind).toBe('auto')
  })

  it('an order confirmation with amount + merchant + date attaches automatically; the status machine (not the matcher) keeps the record partially matched until a cost document arrives', () => {
    const order = invoice({ kind: 'order_confirmation_email', createdAt: '2026-09-05T13:00:00Z' }, { invoiceNumber: null, invoiceDate: null, vatCents: null })
    const d = decideMatch(rankCandidates(order, [payment()]))
    expect(d.kind).toBe('auto')
  })

  it('an order confirmation that only names the merchant (no amount) is partial at best', () => {
    const order = invoice({ kind: 'order_confirmation_email', createdAt: '2026-09-05T13:00:00Z' }, { invoiceNumber: null, invoiceDate: null, vatCents: null, grossCents: null, orderNumber: null })
    const d = decideMatch(rankCandidates(order, [payment()]))
    expect(d.kind).toBe('none')
    const withOrder = decideMatch(rankCandidates({ ...order, extracted: { ...order.extracted, orderNumber: '12345' } }, [payment({ bankDescription: 'BOL.COM order 12345' })]))
    expect(withOrder.kind).toBe('partial')
  })

  it('two identical payments on consecutive days → review, never a coin flip', () => {
    const ranked = rankCandidates(invoice(), [payment({ id: 'a', paidAt: '2026-09-05T12:00:00Z' }), payment({ id: 'b', paidAt: '2026-09-06T12:00:00Z' })])
    const d = decideMatch(ranked)
    expect(d.kind).toBe('review')
    if (d.kind === 'review') expect([d.best.expense.id, d.runnerUp.expense.id].sort()).toEqual(['a', 'b'])
  })

  it('the order number in one payment\'s reference breaks a would-be tie', () => {
    const ranked = rankCandidates(invoice(), [payment({ id: 'a' }), payment({ id: 'b', bankDescription: 'BOL.COM order 12345' })])
    const d = decideMatch(ranked)
    expect(d.kind).toBe('auto')
    if (d.kind === 'auto') expect(d.best.expense.id).toBe('b')
  })

  it('nothing plausible → none, and zero-score candidates are dropped from the ranking', () => {
    const ranked = rankCandidates(invoice({}, { currency: 'USD' }), [payment()])
    expect(ranked).toEqual([])
    expect(decideMatch(ranked).kind).toBe('none')
  })

  it('ties on score fall back to the closer payment date', () => {
    const doc = invoice({}, { invoiceDate: '2026-09-08' })
    const ranked = rankCandidates(doc, [payment({ id: 'far', paidAt: '2026-08-30T12:00:00Z', supplierName: 'Bol.com' }), payment({ id: 'near', paidAt: '2026-09-06T12:00:00Z', supplierName: 'Bol.com' })])
    expect(ranked[0].expense.id).toBe('near')
  })
})
