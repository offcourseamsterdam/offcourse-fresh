import { describe, it, expect } from 'vitest'
import { decideExpenseForTransaction, type ExpenseSourceTransaction } from './from-transaction'
import type { Classification } from '@/lib/finance/cockpit/classify/rules'

const tx = (over: Partial<ExpenseSourceTransaction> = {}): ExpenseSourceTransaction => ({
  id: 'bt-1', type: 'card_payment', state: 'completed', amountCents: -12100,
  completedAt: '2026-09-05T12:00:00Z', createdAt: '2026-09-05T11:59:00Z',
  merchantName: 'Bol.com', counterpartyName: null, description: 'BOL.COM BV', reference: null,
  ...over,
})
const rule = (category: string, subcategory: string): Classification =>
  ({ category, subcategory, confidence: 1, reason: 'test', source: 'rule' }) as unknown as Classification

describe('decideExpenseForTransaction', () => {
  it('a completed card payment becomes an expense waiting for its invoice', () => {
    const d = decideExpenseForTransaction(tx(), null)
    expect(d.kind).toBe('create')
    if (d.kind === 'create') {
      expect(d.insert).toMatchObject({ bank_transaction_id: 'bt-1', cash_out_cents: 12100, paid_at: '2026-09-05T12:00:00Z', supplier_name: 'Bol.com', status: 'waiting_for_invoice' })
    }
  })

  it('incoming money is never an expense', () => {
    expect(decideExpenseForTransaction(tx({ amountCents: 160800 }), null)).toEqual({ kind: 'skip', reason: 'incoming' })
  })

  it('a pending or reverted transaction is not an expense yet', () => {
    expect(decideExpenseForTransaction(tx({ state: 'pending' }), null)).toEqual({ kind: 'skip', reason: 'not_completed' })
    expect(decideExpenseForTransaction(tx({ state: 'reverted' }), null)).toEqual({ kind: 'skip', reason: 'not_completed' })
  })

  it('an internal transfer (structural rule) is recorded but ignored — no document will ever exist', () => {
    const d = decideExpenseForTransaction(tx({ type: 'transfer', merchantName: null, counterpartyName: 'Off Course Pocket' }), rule('transfer', 'internal'))
    expect(d.kind).toBe('ignored')
    if (d.kind === 'ignored') expect(d.insert.status).toBe('ignored')
  })

  it('a Revolut fee is ignored whether by type or by rule', () => {
    expect(decideExpenseForTransaction(tx({ type: 'fee' }), null).kind).toBe('ignored')
    expect(decideExpenseForTransaction(tx({ type: 'transfer' }), rule('operating', 'fees')).kind).toBe('ignored')
  })

  it('exchange, top-up and ATM are never purchases', () => {
    for (const type of ['exchange', 'topup', 'atm']) expect(decideExpenseForTransaction(tx({ type }), null).kind).toBe('ignored')
  })

  it('falls back through merchant → counterparty → description for the supplier name, and to created_at when completed_at is missing', () => {
    const d = decideExpenseForTransaction(tx({ merchantName: null, counterpartyName: null, description: 'Jachthaven', completedAt: null }), null)
    if (d.kind === 'create') {
      expect(d.insert.supplier_name).toBe('Jachthaven')
      expect(d.insert.paid_at).toBe('2026-09-05T11:59:00Z')
    } else throw new Error('expected create')
  })
})
