import { describe, it, expect } from 'vitest'
import { buildFhBookingPlan } from './finalize-booking'
import type Stripe from 'stripe'

/**
 * buildFhBookingPlan is the shared core used by BOTH the Stripe webhook and the
 * pending-fh-sweep retry cron — its own file comment says "a drift here is
 * exactly the kind of money-path bug we've been burned by before." Previously
 * untested entirely, including the shared-cruise multi-rate path (the exact
 * bug class already fixed once: child tickets priced as adults). Pure function,
 * no mocks needed.
 */

function makePI(metadata: Record<string, string>, id = 'pi_test_123'): Stripe.PaymentIntent {
  return { id, metadata } as unknown as Stripe.PaymentIntent
}

describe('buildFhBookingPlan', () => {
  it('private booking: exactly 1 customer entry regardless of guest_count', () => {
    const pi = makePI({
      category: 'private', guest_count: '4', customer_type_rate_pk: '2002',
      avail_pk: '1001', date: '2026-08-01',
      guest_name: 'Test Guest', guest_phone: '+31600000000', guest_email: 't@example.com',
    })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body.customers).toEqual([{ customer_type_rate: 2002 }])
    expect(plan.availPk).toBe(1001)
    expect(plan.date).toBe('2026-08-01')
  })

  it('shared booking, single rate: one customer entry per guest, all the same rate', () => {
    const pi = makePI({
      category: 'shared', guest_count: '3', customer_type_rate_pk: '5005',
      avail_pk: '2002', date: '2026-08-02',
    })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body.customers).toEqual([
      { customer_type_rate: 5005 },
      { customer_type_rate: 5005 },
      { customer_type_rate: 5005 },
    ])
  })

  it('SECURITY: shared booking, multi-rate (adult+child mix) expands to the correct per-type customer entries', () => {
    // The exact bug class already fixed once: child tickets must use the child rate pk,
    // not silently collapse to the adult rate.
    const pi = makePI({
      category: 'shared', guest_count: '3', customer_type_rate_pk: '100', // adult pk (fallback, unused here)
      customer_type_rates: JSON.stringify([{ pk: 100, count: 2 }, { pk: 200, count: 1 }]),
      avail_pk: '3003', date: '2026-08-03',
    })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body.customers).toEqual([
      { customer_type_rate: 100 },
      { customer_type_rate: 100 },
      { customer_type_rate: 200 },
    ])
  })

  it('private category ignores customer_type_rates even if present in metadata (defensive — should never happen in practice)', () => {
    const pi = makePI({
      category: 'private', guest_count: '2', customer_type_rate_pk: '999',
      customer_type_rates: JSON.stringify([{ pk: 100, count: 2 }]),
      avail_pk: '1', date: '2026-08-01',
    })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body.customers).toEqual([{ customer_type_rate: 999 }])
  })

  it('shared booking with an EMPTY customer_type_rates array falls back to the single-rate path', () => {
    const pi = makePI({
      category: 'shared', guest_count: '2', customer_type_rate_pk: '777',
      customer_type_rates: JSON.stringify([]),
      avail_pk: '1', date: '2026-08-01',
    })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body.customers).toEqual([{ customer_type_rate: 777 }, { customer_type_rate: 777 }])
  })

  it('voucher_number is always the PaymentIntent id — the idempotency backbone', () => {
    const pi = makePI({ category: 'private', guest_count: '1', customer_type_rate_pk: '1', avail_pk: '1', date: '2026-08-01' }, 'pi_unique_abc')
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body.voucher_number).toBe('pi_unique_abc')
  })

  it('contact fields are sourced from PI metadata', () => {
    const pi = makePI({
      category: 'private', guest_count: '1', customer_type_rate_pk: '1', avail_pk: '1', date: '2026-08-01',
      guest_name: 'Jane Doe', guest_phone: '+31611111111', guest_email: 'jane@example.com',
    })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body.contact).toEqual({ name: 'Jane Doe', phone: '+31611111111', email: 'jane@example.com' })
  })

  it('missing contact metadata falls back to empty strings, never undefined/crash', () => {
    const pi = makePI({ category: 'private', guest_count: '1', customer_type_rate_pk: '1', avail_pk: '1', date: '2026-08-01' })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body.contact).toEqual({ name: '', phone: '', email: '' })
  })

  it('includes a note when there is catering or a guest note to report', () => {
    const pi = makePI({ category: 'private', guest_count: '1', customer_type_rate_pk: '1', avail_pk: '1', date: '2026-08-01' })
    const plan = buildFhBookingPlan(pi, [
      { name: 'Cheese Platter', category: 'food', amount_cents: 2000, extra_id: 'x', quantity: 1, is_per_person_pick: false },
    ] as never)

    expect(plan.body.note).toBeTruthy()
    expect(plan.body.note).toContain('Cheese Platter')
  })

  it('omits the note field entirely (not an empty string) when there is nothing to report', () => {
    const pi = makePI({ category: 'private', guest_count: '1', customer_type_rate_pk: '1', avail_pk: '1', date: '2026-08-01' })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.body).not.toHaveProperty('note')
  })

  it('missing date in metadata yields an empty-string date (idempotency lookup then short-circuits, per client.ts)', () => {
    const pi = makePI({ category: 'private', guest_count: '1', customer_type_rate_pk: '1', avail_pk: '1' })
    const plan = buildFhBookingPlan(pi, [])

    expect(plan.date).toBe('')
  })
})
