import { describe, it, expect, vi } from 'vitest'
import { claimBooking, finalizeBooking, releaseClaim, CLAIM_STATUS, type BookingInsert } from './claim'

/**
 * In-memory fake of the Supabase client that models the ONE property the
 * race guard depends on: a UNIQUE constraint on bookings.stripe_payment_intent_id,
 * enforced atomically at INSERT time (not at check time). Real atomicity is
 * provided by Postgres (migration 052); this fake reproduces that contract so the
 * tests exercise the win/lose/finalize/release logic deterministically.
 */
function makeFakeSupabase(opts: { insertError?: { code?: string; message: string } } = {}) {
  const rows: Array<Record<string, unknown>> = []
  let autoId = 1

  function insert(values: Record<string, unknown>) {
    if (opts.insertError) {
      return Promise.resolve({ error: opts.insertError })
    }
    const pi = values.stripe_payment_intent_id
    // Non-null PI values are unique; NULLs are allowed to repeat (Postgres semantics).
    if (pi != null && rows.some(r => r.stripe_payment_intent_id === pi)) {
      return Promise.resolve({
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      })
    }
    rows.push({ id: `row_${autoId++}`, ...values })
    return Promise.resolve({ error: null })
  }

  function mutation(kind: 'update' | 'delete', payload: Record<string, unknown> | null) {
    const filters: Array<[string, unknown]> = []
    const builder = {
      eq(col: string, val: unknown) {
        filters.push([col, val])
        return builder
      },
      then(resolve: (v: { error: null }) => void) {
        const match = (r: Record<string, unknown>) => filters.every(([c, v]) => r[c] === v)
        if (kind === 'update' && payload) {
          rows.filter(match).forEach(r => Object.assign(r, payload))
        } else if (kind === 'delete') {
          for (let i = rows.length - 1; i >= 0; i--) {
            if (match(rows[i])) rows.splice(i, 1)
          }
        }
        resolve({ error: null })
      },
    }
    return builder
  }

  const client = {
    rows,
    from() {
      return {
        insert,
        update(payload: Record<string, unknown>) { return mutation('update', payload) },
        delete() { return mutation('delete', null) },
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any
}

function makeRow(pi: string, over: Partial<BookingInsert> = {}): BookingInsert {
  return {
    booking_id: pi,
    stripe_payment_intent_id: pi,
    customer_name: 'Test Guest',
    customer_email: 'guest@example.com',
    status: 'confirmed',
    booking_uuid: 'should-be-nulled-by-claim',
    ...over,
  }
}

describe('claimBooking', () => {
  it('wins the first claim and loses a second claim on the same PaymentIntent', async () => {
    const supabase = makeFakeSupabase()

    const first = await claimBooking(supabase, makeRow('pi_1'))
    const second = await claimBooking(supabase, makeRow('pi_1'))

    expect(first).toEqual({ outcome: 'won' })
    expect(second).toEqual({ outcome: 'lost' })
    // Exactly one row exists for the PI.
    expect(supabase.rows.filter((r: { stripe_payment_intent_id?: string }) => r.stripe_payment_intent_id === 'pi_1')).toHaveLength(1)
  })

  it('forces the claim row into CLAIM_STATUS with a null booking_uuid', async () => {
    const supabase = makeFakeSupabase()
    await claimBooking(supabase, makeRow('pi_2', { status: 'confirmed', booking_uuid: 'uuid-from-caller' }))

    const row = supabase.rows.find((r: { stripe_payment_intent_id?: string }) => r.stripe_payment_intent_id === 'pi_2')
    expect(row.status).toBe(CLAIM_STATUS)
    expect(row.booking_uuid).toBeNull()
  })

  it('allows independent PaymentIntents to both win', async () => {
    const supabase = makeFakeSupabase()
    expect(await claimBooking(supabase, makeRow('pi_a'))).toEqual({ outcome: 'won' })
    expect(await claimBooking(supabase, makeRow('pi_b'))).toEqual({ outcome: 'won' })
  })

  it('returns error (not lost) when the insert fails for a non-unique reason', async () => {
    const supabase = makeFakeSupabase({ insertError: { code: '08006', message: 'connection failure' } })
    const result = await claimBooking(supabase, makeRow('pi_3'))
    expect(result).toEqual({ outcome: 'error', error: 'connection failure' })
  })
})

describe('finalizeBooking', () => {
  it('promotes the claimed row to confirmed with the real FareHarbor UUID', async () => {
    const supabase = makeFakeSupabase()
    await claimBooking(supabase, makeRow('pi_fin'))

    const result = await finalizeBooking(supabase, 'pi_fin', { bookingUuid: 'fh-uuid-123' })

    expect(result).toEqual({ ok: true })
    const row = supabase.rows.find((r: { stripe_payment_intent_id?: string }) => r.stripe_payment_intent_id === 'pi_fin')
    expect(row.status).toBe('confirmed')
    expect(row.booking_uuid).toBe('fh-uuid-123')
  })
})

describe('releaseClaim', () => {
  it('deletes a still-pending claim so a retry can re-attempt', async () => {
    const supabase = makeFakeSupabase()
    await claimBooking(supabase, makeRow('pi_rel'))

    await releaseClaim(supabase, 'pi_rel')

    expect(supabase.rows.filter((r: { stripe_payment_intent_id?: string }) => r.stripe_payment_intent_id === 'pi_rel')).toHaveLength(0)
  })

  it('never deletes a finalized booking (status guard)', async () => {
    const supabase = makeFakeSupabase()
    await claimBooking(supabase, makeRow('pi_done'))
    await finalizeBooking(supabase, 'pi_done', { bookingUuid: 'fh-uuid-done' })

    await releaseClaim(supabase, 'pi_done')

    // The confirmed row survives — releaseClaim only removes CLAIM_STATUS rows.
    expect(supabase.rows.filter((r: { stripe_payment_intent_id?: string }) => r.stripe_payment_intent_id === 'pi_done')).toHaveLength(1)
  })
})

describe('the double-create race', () => {
  it('two paths racing for one PaymentIntent create exactly one FareHarbor booking', async () => {
    const supabase = makeFakeSupabase()
    const createFareHarborBooking = vi.fn(async () => ({ uuid: 'fh-uuid-race' }))

    // Each racer mirrors the production flow: claim → (if won) create FH → finalize.
    async function racer() {
      const claim = await claimBooking(supabase, makeRow('pi_race'))
      if (claim.outcome !== 'won') return 'backed-off'
      const booking = await createFareHarborBooking()
      await finalizeBooking(supabase, 'pi_race', { bookingUuid: booking.uuid })
      return 'booked'
    }

    const results = await Promise.all([racer(), racer()])

    // Exactly one path reached FareHarbor.
    expect(createFareHarborBooking).toHaveBeenCalledTimes(1)
    expect(results.filter(r => r === 'booked')).toHaveLength(1)
    expect(results.filter(r => r === 'backed-off')).toHaveLength(1)

    // Exactly one confirmed booking row, with the FareHarbor UUID.
    const piRows = supabase.rows.filter((r: { stripe_payment_intent_id?: string }) => r.stripe_payment_intent_id === 'pi_race')
    expect(piRows).toHaveLength(1)
    expect(piRows[0].status).toBe('confirmed')
    expect(piRows[0].booking_uuid).toBe('fh-uuid-race')
  })

  it('the losing path never calls FareHarbor even when it wins validation', async () => {
    const supabase = makeFakeSupabase()
    // First path already claimed (e.g. the webhook fired first).
    await claimBooking(supabase, makeRow('pi_lost'))

    const createFareHarborBooking = vi.fn(async () => ({ uuid: 'nope' }))
    const claim = await claimBooking(supabase, makeRow('pi_lost'))
    if (claim.outcome === 'won') await createFareHarborBooking()

    expect(claim).toEqual({ outcome: 'lost' })
    expect(createFareHarborBooking).not.toHaveBeenCalled()
  })
})
