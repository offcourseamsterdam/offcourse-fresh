import { describe, it, expect, vi } from 'vitest'
import type Stripe from 'stripe'
import { resolveStripeFeeCents } from './fee'

// resolveStripeFeeCents takes the Stripe client as a parameter, so it's
// tested here with a minimal fake client (just the one method it calls) —
// no module mocking needed, unlike the webhook route which mocks this whole
// function instead of exercising it.
function fakeStripe(retrieveImpl: (id: string) => Promise<Partial<Stripe.Charge>>) {
  return { charges: { retrieve: vi.fn(retrieveImpl) } } as unknown as Stripe
}

function pi(latestCharge: Stripe.PaymentIntent['latest_charge']): Stripe.PaymentIntent {
  return { latest_charge: latestCharge } as Stripe.PaymentIntent
}

describe('resolveStripeFeeCents', () => {
  it('resolves the fee when latest_charge is a string id', async () => {
    const stripe = fakeStripe(async id => {
      expect(id).toBe('ch_123')
      return { balance_transaction: { fee: 250 } as Stripe.BalanceTransaction }
    })
    expect(await resolveStripeFeeCents(stripe, pi('ch_123'))).toBe(250)
  })

  it('resolves the fee when latest_charge is an already-expanded object', async () => {
    const stripe = fakeStripe(async id => {
      expect(id).toBe('ch_456')
      return { balance_transaction: { fee: 199 } as Stripe.BalanceTransaction }
    })
    const expandedCharge = { id: 'ch_456' } as Stripe.Charge
    expect(await resolveStripeFeeCents(stripe, pi(expandedCharge))).toBe(199)
  })

  it('returns null without calling Stripe when there is no latest_charge', async () => {
    const retrieve = vi.fn()
    const stripe = { charges: { retrieve } } as unknown as Stripe
    expect(await resolveStripeFeeCents(stripe, pi(null))).toBeNull()
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('returns null when balance_transaction is not expanded (still a string id)', async () => {
    const stripe = fakeStripe(async () => ({ balance_transaction: 'txn_not_expanded' }))
    expect(await resolveStripeFeeCents(stripe, pi('ch_789'))).toBeNull()
  })

  it('returns null when balance_transaction is null (not settled yet)', async () => {
    const stripe = fakeStripe(async () => ({ balance_transaction: null }))
    expect(await resolveStripeFeeCents(stripe, pi('ch_789'))).toBeNull()
  })

  it('returns null (never throws) when the Stripe API call fails', async () => {
    const stripe = fakeStripe(async () => { throw new Error('Stripe API error') })
    expect(await resolveStripeFeeCents(stripe, pi('ch_bad'))).toBeNull()
  })

  it('requests balance_transaction expansion on every lookup', async () => {
    const retrieve = vi.fn().mockResolvedValue({ balance_transaction: { fee: 100 } })
    const stripe = { charges: { retrieve } } as unknown as Stripe
    await resolveStripeFeeCents(stripe, pi('ch_123'))
    expect(retrieve).toHaveBeenCalledWith('ch_123', { expand: ['balance_transaction'] })
  })
})
