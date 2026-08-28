import { describe, it, expect, vi, beforeEach } from 'vitest'

const retrievePaymentIntent = vi.fn()
vi.mock('@/lib/stripe/server', () => ({ getStripe: () => ({ paymentIntents: { retrieve: retrievePaymentIntent } }) }))

import { importFareharborBooking, type ImportableBooking } from './import-booking'

/** The one grounded example (see ota/detect.test.ts) — booking #369057638. */
const BOOKING: ImportableBooking = {
  bookingPk: 369057638,
  bookingSource: 'getyourguide',
  guestName: 'shoshana mccallum',
  guestEmail: 'customer-xzxhygwncrx37du3@reply.getyourguide.com',
  guestPhone: '+64 21 248 0388',
  dateISO: '2026-08-05',
  time: '17:00',
  endTime: '18:30',
  guests: 2,
  experienceName: 'Shared Cruise',
}

function makeSupabase({ existingBooking, insertError }: { existingBooking?: unknown; insertError?: { message: string } }) {
  const inserted: Record<string, unknown>[] = []

  function bookingsBuilder() {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: existingBooking ?? null }),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row)
        return builder
      },
      single: async () => (insertError ? { data: null, error: insertError } : { data: { id: 'bk-new-1' }, error: null }),
    }
    return builder
  }

  const from = vi.fn(() => bookingsBuilder())
  return { client: { from }, inserted }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importFareharborBooking', () => {
  it('builds the row from the notification\'s own fields — no live FareHarbor call, correct Amsterdam→UTC times', async () => {
    const sb = makeSupabase({})

    const result = await importFareharborBooking(sb.client as never, BOOKING)

    expect(result).toEqual({ ok: true, bookingId: 'bk-new-1', date: '2026-08-05' })
    expect(sb.inserted).toHaveLength(1)
    expect(sb.inserted[0]).toEqual({
      booking_id: 'fh_369057638',
      external_id: '369057638',
      tour_item_name: 'Shared Cruise',
      category: 'shared',
      booking_date: '2026-08-05',
      start_time: '2026-08-05T15:00:00.000Z', // 17:00 Amsterdam, CEST = UTC+2
      end_time: '2026-08-05T16:30:00.000Z', // 18:30 Amsterdam
      guest_count: 2,
      customer_name: 'shoshana mccallum',
      customer_email: 'customer-xzxhygwncrx37du3@reply.getyourguide.com',
      customer_phone: '+64 21 248 0388',
      status: 'confirmed',
      payment_status: 'paid_externally',
      currency: 'eur',
      booking_source: 'getyourguide',
      stripe_payment_intent_id: null,
      stripe_amount: 0,
      discount_amount_cents: 0,
    })
  })

  it('fetches the real Stripe charge and stamps it as paid, instead of the €0 comp, when stripePaymentIntentId is set (Boat Local own_channel)', async () => {
    const sb = makeSupabase({})
    retrievePaymentIntent.mockResolvedValue({ amount: 31000, amount_received: 31000 })

    const result = await importFareharborBooking(sb.client as never, {
      ...BOOKING,
      bookingSource: 'boatlocal',
      stripePaymentIntentId: 'pi_3U0pbNGh1qCF71Ta0pKRNwmw',
    })

    expect(result).toEqual({ ok: true, bookingId: 'bk-new-1', date: '2026-08-05' })
    expect(retrievePaymentIntent).toHaveBeenCalledWith('pi_3U0pbNGh1qCF71Ta0pKRNwmw')
    expect(sb.inserted[0]).toMatchObject({
      booking_source: 'boatlocal',
      stripe_payment_intent_id: 'pi_3U0pbNGh1qCF71Ta0pKRNwmw',
      stripe_amount: 31000,
      payment_status: 'paid',
    })
  })

  it('defaults guest_count to 1 and customer_name to "Unknown" when the notification did not expose them', async () => {
    const sb = makeSupabase({})

    const result = await importFareharborBooking(sb.client as never, { ...BOOKING, guests: null, guestName: null, guestEmail: null })

    expect(result.ok).toBe(true)
    expect(sb.inserted[0]).toMatchObject({ guest_count: 1, customer_name: 'Unknown', customer_email: '' })
  })

  it('derives category="private" from an experience name containing "Private" (case-insensitive)', async () => {
    const sb = makeSupabase({})

    await importFareharborBooking(sb.client as never, { ...BOOKING, experienceName: 'Private Cruise (Diana, 2h)' })

    expect(sb.inserted[0]).toMatchObject({ category: 'private' })
  })

  it('leaves category null when the experience name says neither "Shared" nor "Private"', async () => {
    const sb = makeSupabase({})

    await importFareharborBooking(sb.client as never, { ...BOOKING, experienceName: null })

    expect(sb.inserted[0]).toMatchObject({ category: null })
  })

  it('leaves end_time null when the notification had no end time', async () => {
    const sb = makeSupabase({})

    await importFareharborBooking(sb.client as never, { ...BOOKING, endTime: null })

    expect(sb.inserted[0]).toMatchObject({ end_time: null })
  })

  it('fails without inserting when the date or time could not be read from the notification', async () => {
    const sb = makeSupabase({})

    const result = await importFareharborBooking(sb.client as never, { ...BOOKING, time: null })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('Could not read a clear date/time') })
    expect(sb.inserted).toHaveLength(0)
  })

  it('fails without inserting when this booking is already in our database', async () => {
    const sb = makeSupabase({ existingBooking: { id: 'bk-existing' } })

    const result = await importFareharborBooking(sb.client as never, BOOKING)

    expect(result).toEqual({ ok: false, error: 'This booking is already in our database.' })
    expect(sb.inserted).toHaveLength(0)
  })

  it('surfaces the Supabase error when the insert itself fails', async () => {
    const sb = makeSupabase({ insertError: { message: 'duplicate key value' } })

    const result = await importFareharborBooking(sb.client as never, BOOKING)

    expect(result).toEqual({ ok: false, error: 'duplicate key value' })
  })
})
