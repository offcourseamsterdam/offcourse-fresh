import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests the payment-intent claim mutex that prevents one payment from producing
 * two FareHarbor bookings:
 *   - 'won' when the claim row is inserted.
 *   - 'duplicate' when a bookings row already exists for the PI.
 *   - 'in_flight' when another live path holds a fresh claim and no booking yet.
 *   - stale claims (crashed owner) are reclaimed → 'won'.
 *   - any infrastructure failure degrades to 'unavailable' (caller proceeds).
 *   - releaseClaim deletes the claim row by PI.
 */

const h = vi.hoisted(() => ({
  claimInsert: vi.fn(),   // booking_claims.upsert(...).select()
  bookingLookup: vi.fn(), // bookings.select('id').eq().maybeSingle()
  claimLookup: vi.fn(),   // booking_claims.select('created_at').eq().maybeSingle()
  claimDelete: vi.fn().mockResolvedValue({ error: null }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'booking_claims') {
        return {
          upsert: () => ({ select: () => h.claimInsert() }),
          select: () => ({ eq: () => ({ maybeSingle: h.claimLookup }) }),
          delete: () => ({ eq: (col: string, val: string) => h.claimDelete(col, val) }),
        }
      }
      // bookings
      return { select: () => ({ eq: () => ({ maybeSingle: h.bookingLookup }) }) }
    },
  }),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { claimPaymentIntent, releaseClaim } from './booking-claims'

const db = () => createAdminClient()

describe('claimPaymentIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.claimInsert.mockResolvedValue({ data: [{ payment_intent_id: 'pi_x' }], error: null })
    h.bookingLookup.mockResolvedValue({ data: null })
    h.claimLookup.mockResolvedValue({ data: null })
    h.claimDelete.mockResolvedValue({ error: null })
  })

  it("returns 'won' when the claim row is inserted", async () => {
    expect(await claimPaymentIntent(db(), 'pi_x')).toBe('won')
  })

  it("returns 'duplicate' when a booking already exists for the PI", async () => {
    h.claimInsert.mockResolvedValue({ data: [], error: null }) // lost the claim
    h.bookingLookup.mockResolvedValue({ data: { id: 'b1' } })
    expect(await claimPaymentIntent(db(), 'pi_x')).toBe('duplicate')
  })

  it("returns 'in_flight' when a fresh claim is held and no booking exists yet", async () => {
    h.claimInsert.mockResolvedValue({ data: [], error: null })
    h.bookingLookup.mockResolvedValue({ data: null })
    h.claimLookup.mockResolvedValue({ data: { created_at: new Date().toISOString() } }) // fresh
    expect(await claimPaymentIntent(db(), 'pi_x')).toBe('in_flight')
  })

  it("reclaims a stale claim (crashed owner) → 'won'", async () => {
    h.claimInsert
      .mockResolvedValueOnce({ data: [], error: null })                          // first: lost
      .mockResolvedValueOnce({ data: [{ payment_intent_id: 'pi_x' }], error: null }) // reclaim: won
    h.bookingLookup.mockResolvedValue({ data: null })
    h.claimLookup.mockResolvedValue({ data: { created_at: new Date(Date.now() - 120_000).toISOString() } }) // stale

    expect(await claimPaymentIntent(db(), 'pi_x')).toBe('won')
    expect(h.claimDelete).toHaveBeenCalled() // stale claim deleted before re-claim
  })

  it("does NOT reclaim a fresh claim", async () => {
    h.claimInsert.mockResolvedValue({ data: [], error: null })
    h.bookingLookup.mockResolvedValue({ data: null })
    h.claimLookup.mockResolvedValue({ data: { created_at: new Date(Date.now() - 5_000).toISOString() } }) // fresh
    expect(await claimPaymentIntent(db(), 'pi_x')).toBe('in_flight')
    expect(h.claimDelete).not.toHaveBeenCalled()
  })

  it("returns 'unavailable' when the claim table errors (degrade to legacy behaviour)", async () => {
    h.claimInsert.mockResolvedValue({ data: null, error: { message: 'relation "booking_claims" does not exist' } })
    expect(await claimPaymentIntent(db(), 'pi_x')).toBe('unavailable')
  })

  it("returns 'unavailable' when the claim query throws", async () => {
    h.claimInsert.mockRejectedValue(new Error('connection reset'))
    expect(await claimPaymentIntent(db(), 'pi_x')).toBe('unavailable')
  })
})

describe('releaseClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.claimDelete.mockResolvedValue({ error: null })
  })

  it('deletes the claim row by payment-intent id', async () => {
    await releaseClaim(db(), 'pi_rel')
    expect(h.claimDelete).toHaveBeenCalledWith('payment_intent_id', 'pi_rel')
  })

  it('never throws even if the delete fails', async () => {
    h.claimDelete.mockRejectedValue(new Error('db down'))
    await expect(releaseClaim(db(), 'pi_rel')).resolves.toBeUndefined()
  })
})

describe('claimPaymentIntent — concurrent racers (the core guarantee)', () => {
  // The whole point of the mutex: however many paths race for one payment,
  // exactly one wins (and therefore only one FareHarbor booking is ever created).
  it.each([2, 3, 5])('lets exactly ONE of %i concurrent claims win', async (n) => {
    vi.clearAllMocks()
    h.bookingLookup.mockResolvedValue({ data: null })
    h.claimLookup.mockResolvedValue({ data: { created_at: new Date().toISOString() } }) // fresh, not stale
    h.claimDelete.mockResolvedValue({ error: null })
    // The first INSERT wins; every later one conflicts (empty result = lost).
    h.claimInsert.mockResolvedValue({ data: [], error: null })
    h.claimInsert.mockResolvedValueOnce({ data: [{ payment_intent_id: 'pi_race' }], error: null })

    const outcomes = await Promise.all(
      Array.from({ length: n }, () => claimPaymentIntent(db(), 'pi_race')),
    )

    expect(outcomes.filter(o => o === 'won')).toHaveLength(1)
  })
})
