import { describe, it, expect } from 'vitest'
import { mapTransaction, pendingSums, pickAccount } from './sync'
import type { RevolutAccount, RevolutTransaction } from './client'

const acc = (o: Partial<RevolutAccount>): RevolutAccount => ({ id: 'a', balance: 0, currency: 'EUR', state: 'active', public: false, created_at: '', updated_at: '', ...o })

describe('pickAccount', () => {
  it('prefers the configured account id', () => {
    expect(pickAccount([acc({ id: 'x' }), acc({ id: 'y' })], 'y')?.id).toBe('y')
  })
  it('falls back to the active EUR current account, then any active EUR', () => {
    expect(pickAccount([acc({ id: 'gbp', currency: 'GBP' }), acc({ id: 'pocket', account_type: 'pocket' }), acc({ id: 'main', account_type: 'current' })], null)?.id).toBe('main')
    expect(pickAccount([acc({ id: 'only' })], 'missing')?.id).toBe('only')
    expect(pickAccount([acc({ id: 'closed', state: 'inactive' })], null)).toBeNull()
  })
})

describe('mapTransaction', () => {
  const tx: RevolutTransaction = {
    id: '640c2b97', type: 'card_payment', state: 'completed', request_id: 'REVP:1',
    created_at: '2026-09-01T07:19:51Z', updated_at: '2026-09-02T02:13:36Z', completed_at: '2026-09-02T02:13:36Z',
    merchant: { name: 'Shell', category_code: '5541', country: 'NLD' },
    legs: [{ leg_id: 'l1', account_id: 'main', amount: -86.32, fee: 0, currency: 'EUR', description: 'Shell Amsterdam', balance: 52393.68 }],
  }
  it('maps our EUR leg to integer cents with feed columns only', () => {
    const row = mapTransaction(tx, 'main', '2026-09-04T10:00:00Z')!
    expect(row).toMatchObject({
      revolut_id: '640c2b97', type: 'card_payment', state: 'completed', account_id: 'main',
      amount_cents: -8632, fee_cents: 0, currency: 'EUR', balance_after_cents: 5239368,
      description: 'Shell Amsterdam', last_synced_at: '2026-09-04T10:00:00Z',
    })
    expect(row.merchant).toMatchObject({ name: 'Shell' })
    expect(row).not.toHaveProperty('category')
    expect(row).not.toHaveProperty('needs_review')
  })
  it('ignores transactions that have no leg on our account', () => {
    expect(mapTransaction({ ...tx, legs: [{ leg_id: 'l', account_id: 'other', amount: 1, currency: 'EUR' }] }, 'main', 'now')).toBeNull()
  })
  it('falls back to the merchant name when the leg has no description', () => {
    const row = mapTransaction({ ...tx, legs: [{ ...tx.legs[0], description: undefined }] }, 'main', 'now')!
    expect(row.description).toBe('Shell')
  })
})

describe('pendingSums', () => {
  it('splits pending amounts by direction and ignores completed ones', () => {
    expect(pendingSums([
      { state: 'pending', amount_cents: -45000 },
      { state: 'created', amount_cents: -5000 },
      { state: 'pending', amount_cents: 400000 },
      { state: 'completed', amount_cents: -999999 },
      { state: 'reverted', amount_cents: 1 },
    ])).toEqual({ pendingOutCents: 50000, pendingInCents: 400000 })
  })
})
