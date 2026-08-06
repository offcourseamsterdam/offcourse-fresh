import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./check-availability', () => ({ checkOtaAvailability: vi.fn() }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackCritical: vi.fn() }))

import { handleOtaMessage } from './handle-message'
import { checkOtaAvailability } from './check-availability'
import { postSlackCritical } from '@/lib/slack/send-notification'
import type { OtaDetection } from './detect'

const NEW_REQUEST: OtaDetection = {
  platform: 'withlocals',
  kind: 'new_request',
  bookingRef: '39f8dc7a',
  guestName: null,
  guestEmail: null,
  guestPhone: null,
  endTime: null,
  stripePaymentIntentId: null,
  parsed: { date: 'Thursday, September 24, 2026 at 10:30', time: null, dateISO: '2026-09-24', guests: 2, experienceName: 'Private Canal Cruise' },
}

function fakeSupabase(opts: { bookingsMatch?: { id: string } | null } = {}) {
  const inserted: Record<string, unknown>[] = []
  const conversationUpdates: Record<string, unknown>[] = []
  const bookingsMatch = opts.bookingsMatch ?? null
  return {
    inserted,
    conversationUpdates,
    from: (table: string) => {
      if (table === 'agent_proposals') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table === 'conversations') {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: () => {
              conversationUpdates.push(patch)
              return Promise.resolve({ data: null, error: null })
            },
          }),
        }
      }
      if (table === 'bookings') {
        // Chainable: own_channel's lookup calls either one .eq() (Stripe PI
        // match) or two chained .eq()s (email + date fallback) before
        // .maybeSingle() — both need to resolve to the same configured result.
        const chain = { eq: () => chain, maybeSingle: () => Promise.resolve({ data: bookingsMatch, error: null }) }
        return { select: () => chain }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleOtaMessage', () => {
  it('checks availability and writes an ota_availability proposal for a new request', async () => {
    vi.mocked(checkOtaAvailability).mockResolvedValue({
      checked: true,
      dateISO: '2026-09-24',
      guests: 2,
      availability: {
        available: true,
        listings: [
          { category: 'shared', listing: 'Hidden Gems Shared Cruise', options: [{ name: 'Adult', price_eur: 35, duration_min: 90 }] },
          { category: 'private', listing: 'Private Hidden Gems Cruise', options: [{ name: 'Diana - 1.5 Hours', price_eur: 310, duration_min: 90 }] },
        ],
      },
    })
    const supabase = fakeSupabase()

    await handleOtaMessage(supabase as never, NEW_REQUEST, 'conv-1', 'msg-1')

    expect(checkOtaAvailability).toHaveBeenCalledWith(NEW_REQUEST)
    expect(supabase.conversationUpdates).toEqual([{ ota_status: 'waiting', ota_available: true }])
    expect(supabase.inserted).toHaveLength(1)
    expect(supabase.inserted[0]).toMatchObject({
      kind: 'ota_availability',
      conversation_id: 'conv-1',
      trigger_message_id: 'msg-1',
      status: 'shadow',
    })
    expect(supabase.inserted[0].payload).toMatchObject({
      platform: 'withlocals',
      bookingRef: '39f8dc7a',
      checked: true,
      bookable: true,
      cheapestOption: { name: 'Diana - 1.5 Hours', price_eur: 310, duration_min: 90 },
    })
  })

  it('marks ota_available false when only a shared-cruise slot exists — Withlocals/GetMyBoat requests are always private', async () => {
    vi.mocked(checkOtaAvailability).mockResolvedValue({
      checked: true,
      dateISO: '2026-09-24',
      guests: 2,
      availability: {
        available: true,
        listings: [{ category: 'shared', listing: 'Hidden Gems Shared Cruise', options: [{ name: 'Adult', price_eur: 35, duration_min: 90 }] }],
      },
    })
    const supabase = fakeSupabase()

    await handleOtaMessage(supabase as never, NEW_REQUEST, 'conv-1', 'msg-1')

    expect(supabase.conversationUpdates).toEqual([{ ota_status: 'waiting', ota_available: false }])
    expect(supabase.inserted[0].payload).toMatchObject({ bookable: false })
  })

  it('marks ota_available null when the date/guest count could not be checked', async () => {
    vi.mocked(checkOtaAvailability).mockResolvedValue({ checked: false, reason: 'Could not read a clear date.' })
    const supabase = fakeSupabase()

    await handleOtaMessage(supabase as never, NEW_REQUEST, 'conv-1', 'msg-1')

    expect(supabase.conversationUpdates).toEqual([{ ota_status: 'waiting', ota_available: null }])
  })

  it('writes an ota_booking_ready proposal for a confirmed booking, without checking availability', async () => {
    const supabase = fakeSupabase()
    const confirmed: OtaDetection = { ...NEW_REQUEST, kind: 'confirmed' }

    await handleOtaMessage(supabase as never, confirmed, 'conv-2', 'msg-2')

    expect(checkOtaAvailability).not.toHaveBeenCalled()
    expect(supabase.conversationUpdates).toEqual([{ ota_status: 'confirmed' }])
    expect(supabase.inserted).toHaveLength(1)
    expect(supabase.inserted[0]).toMatchObject({
      kind: 'ota_booking_ready',
      conversation_id: 'conv-2',
      trigger_message_id: 'msg-2',
      status: 'shadow',
    })
    expect(supabase.inserted[0].payload).toMatchObject({
      platform: 'withlocals',
      bookingRef: '39f8dc7a',
    })
  })

  it('writes a fh_booking_import_ready proposal for a needs_import notification, without checking availability', async () => {
    const supabase = fakeSupabase()
    const needsImport: OtaDetection = {
      platform: 'getyourguide',
      kind: 'needs_import',
      bookingRef: '369057638',
      guestName: 'shoshana mccallum',
      guestEmail: 'customer-xzxhygwncrx37du3@reply.getyourguide.com',
      guestPhone: '+64 21 248 0388',
      endTime: '18:30',
      stripePaymentIntentId: null,
      parsed: { date: '5 August 2026', time: '17:00', dateISO: '2026-08-05', guests: 2, experienceName: 'Shared Cruise' },
    }

    await handleOtaMessage(supabase as never, needsImport, 'conv-4', 'msg-4')

    expect(checkOtaAvailability).not.toHaveBeenCalled()
    expect(supabase.conversationUpdates).toEqual([{ ota_status: 'needs_import' }])
    expect(supabase.inserted).toHaveLength(1)
    expect(supabase.inserted[0]).toMatchObject({
      kind: 'fh_booking_import_ready',
      conversation_id: 'conv-4',
      trigger_message_id: 'msg-4',
      status: 'shadow',
    })
    expect(supabase.inserted[0].payload).toMatchObject({
      platform: 'getyourguide',
      bookingRef: '369057638',
      guestName: 'shoshana mccallum',
      guestEmail: 'customer-xzxhygwncrx37du3@reply.getyourguide.com',
      guestPhone: '+64 21 248 0388',
      endTime: '18:30',
    })
  })

  it('does nothing for an unrecognized message shape (kind=other)', async () => {
    const supabase = fakeSupabase()
    const other: OtaDetection = { ...NEW_REQUEST, kind: 'other' }

    await handleOtaMessage(supabase as never, other, 'conv-3', 'msg-3')

    expect(checkOtaAvailability).not.toHaveBeenCalled()
    expect(supabase.inserted).toHaveLength(0)
  })

  /** A fakeSupabase() whose agent_proposals.insert() always fails, to prove the failure isn't swallowed. */
  function fakeSupabaseWithFailingInsert() {
    return {
      from: (table: string) => {
        if (table === 'agent_proposals') return { insert: () => Promise.resolve({ data: null, error: { message: 'insert failed' } }) }
        if (table === 'conversations') return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
        throw new Error(`unexpected table "${table}"`)
      },
    }
  }

  it('throws instead of silently swallowing a failed ota_availability insert — a dropped insert must not look handled', async () => {
    vi.mocked(checkOtaAvailability).mockResolvedValue({ checked: false, reason: 'Could not read a clear date.' })
    const supabase = fakeSupabaseWithFailingInsert()

    await expect(handleOtaMessage(supabase as never, NEW_REQUEST, 'conv-1', 'msg-1')).rejects.toThrow('insert failed')
  })

  it('throws instead of silently swallowing a failed ota_booking_ready insert', async () => {
    const supabase = fakeSupabaseWithFailingInsert()
    const confirmed: OtaDetection = { ...NEW_REQUEST, kind: 'confirmed' }

    await expect(handleOtaMessage(supabase as never, confirmed, 'conv-2', 'msg-2')).rejects.toThrow('insert failed')
  })

  it('throws instead of silently swallowing a failed fh_booking_import_ready insert', async () => {
    const supabase = fakeSupabaseWithFailingInsert()
    const needsImport: OtaDetection = { ...NEW_REQUEST, platform: 'getyourguide', kind: 'needs_import', bookingRef: '369057638' }

    await expect(handleOtaMessage(supabase as never, needsImport, 'conv-4', 'msg-4')).rejects.toThrow('insert failed')
  })
})

describe('handleOtaMessage — own_channel (Boat Local / our own website, see detect.ts)', () => {
  const OWN_CHANNEL: OtaDetection = {
    platform: 'boatlocal',
    kind: 'own_channel',
    bookingRef: '369247385',
    guestName: 'Stefaan Vandist',
    guestEmail: 'mail@stefaanvandist.eu',
    guestPhone: '+32 496 60 93 01',
    endTime: '18:30',
    stripePaymentIntentId: 'pi_3U0pbNGh1qCF71Ta0pKRNwmw',
    parsed: { date: '6 August 2026', time: '17:00', dateISO: '2026-08-06', guests: 2, experienceName: 'Shared Cruise' },
  }

  it('resolves the conversation silently when a matching booking already exists — no proposal, no alert', async () => {
    const supabase = fakeSupabase({ bookingsMatch: { id: 'booking-1' } })

    const result = await handleOtaMessage(supabase as never, OWN_CHANNEL, 'conv-5', 'msg-5')

    expect(supabase.conversationUpdates).toEqual([{ status: 'resolved' }])
    expect(supabase.inserted).toHaveLength(0)
    expect(postSlackCritical).not.toHaveBeenCalled()
    expect(result).toContain('already in our database')
  })

  it('alerts and flags sync_mismatch when no matching booking is found', async () => {
    const supabase = fakeSupabase({ bookingsMatch: null })

    const result = await handleOtaMessage(supabase as never, OWN_CHANNEL, 'conv-6', 'msg-6')

    expect(supabase.conversationUpdates).toEqual([
      { ota_source: 'boatlocal', ota_status: 'sync_mismatch', ota_guest_name: 'Stefaan Vandist' },
    ])
    expect(supabase.inserted).toHaveLength(0)
    expect(postSlackCritical).toHaveBeenCalledTimes(1)
    expect(postSlackCritical).toHaveBeenCalledWith(expect.stringContaining('369247385'))
    expect(result).toContain('no matching row')
  })
})
