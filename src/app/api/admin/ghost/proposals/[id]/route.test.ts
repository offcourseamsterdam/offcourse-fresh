import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The `book` action is the ONLY Ghost code path that creates a real FareHarbor
 * booking (money + a customer confirmation email). Its orchestration — read,
 * prep, atomic claim, money-path reuse, finalize, release-on-failure — was
 * previously untested. These tests exercise it with everything mocked: no
 * network, no DB, no real booking.
 *
 * vitest hoists vi.mock above the imports.
 */
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ghost/book-from-proposal', () => ({ prepareInboxBookingBody: vi.fn() }))
// Pulled in by the route's other actions; stubbed so importing the route is cheap.
vi.mock('@/lib/chat/shadow-drafter', () => ({ draftShadowReply: vi.fn() }))
vi.mock('@/lib/ghost/compare', () => ({ analyzeDifference: vi.fn() }))
vi.mock('@/lib/chat/translate', () => ({ translateToEnglish: vi.fn() }))
vi.mock('@/lib/maintenance/send-email', () => ({ sendMaintenanceEmail: vi.fn() }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: vi.fn() }))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: vi.fn() }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/fareharbor/import-booking', () => ({ importFareharborBooking: vi.fn() }))
vi.mock('@/lib/scheduling/sync-shifts', () => ({ syncShiftsForRange: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/realtime/notify-bookings-changed', () => ({ notifyBookingsChanged: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ghost/cancellation-terms', () => ({ computeCancellationTerms: vi.fn() }))
vi.mock('@/lib/sms/send-sms', () => ({ sendSms: vi.fn() }))
vi.mock('@/lib/ghost/guest-move-drafter', () => ({ revalidateStoredMove: vi.fn() }))
// after() requires a real Next.js request scope, absent when calling POST
// directly in a unit test — run the callback inline instead (fire-and-forget → forget-now).
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => cb() }
})
// Only autonomyForKind is stubbed (default-returns 'ask', overridable per test) —
// levelRank stays real so the guard's actual ranking logic is exercised.
vi.mock('@/lib/ghost/agents', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ghost/agents')>()
  return { ...actual, autonomyForKind: vi.fn(() => 'ask') }
})

import { POST } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import { prepareInboxBookingBody } from '@/lib/ghost/book-from-proposal'
import { sendMaintenanceEmail } from '@/lib/maintenance/send-email'
import { sendConfirmationEmail } from '@/lib/booking/send-confirmation-email'
import { emitOpsEvent } from '@/lib/ops/events'
import { autonomyForKind } from '@/lib/ghost/agents'
import { importFareharborBooking } from '@/lib/fareharbor/import-booking'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { computeCancellationTerms } from '@/lib/ghost/cancellation-terms'
import { sendSms } from '@/lib/sms/send-sms'

const PREP_BODY = { listingSlug: 'private-hidden-gems-cruise', availabilityPk: 9001, bookingSource: 'complimentary' }

/**
 * Route-shaped Supabase stub. `single()` returns the proposal (or, for a
 * table an `insert()` just wrote to, the configured insert result); an
 * `update()` whose payload sets a transient claim status ('booking',
 * 'sending', 'confirming') resolves to `claimed` (the rows the conditional
 * UPDATE matched); other updates resolve empty. Every update/insert payload
 * is captured so we can assert the state machine.
 */
function makeSupabase({
  proposal,
  claimed,
  insertResult = { id: 'bonus1' },
  insertError = null,
  claimError = null,
}: {
  proposal: unknown
  claimed: unknown[]
  insertResult?: unknown
  insertError?: { message: string } | null
  claimError?: { message: string } | null
}) {
  const updates: Array<Record<string, unknown>> = []
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => {
    let pending: Record<string, unknown> | null = null
    let inserted = false
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      single: async () => (inserted ? { data: insertError ? null : insertResult, error: insertError } : { data: proposal }),
      insert: (row: Record<string, unknown>) => {
        inserted = true
        inserts.push({ table, row })
        return builder
      },
      update: (payload: Record<string, unknown>) => {
        pending = payload
        updates.push(payload)
        return builder
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        // Claim statuses (transient or a direct one-step terminal claim, like
        // reject_upsell_bonus's 'skipped') resolve to the matched rows; other
        // plain updates resolve empty.
        const isClaim =
          pending?.status === 'booking' || pending?.status === 'sending' || pending?.status === 'confirming' || pending?.status === 'skipped'
        const result = isClaim ? { data: claimError ? null : claimed, error: claimError } : { data: null, error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return builder
  })
  return { client: { from }, from, updates, inserts }
}

function makeReq(body: unknown, cookie = 'sb-access=secret') {
  return {
    json: async () => body,
    nextUrl: { origin: 'http://localhost:3000' },
    headers: { get: (k: string) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  } as never
}

const PARAMS = { params: Promise.resolve({ id: 'p1' }) }

const bookingProposal = {
  id: 'p1',
  kind: 'booking_proposal',
  status: 'shadow',
  payload: { booking: { listing_slug: 'private-hidden-gems-cruise', date: '2026-06-20', time: '5pm', guests: 4 } },
  conversation: { contact: { name: 'Anna Schmidt', email: 'anna@example.com', phone_e164: '+31600000000' } },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST book action — happy path', () => {
  it('claims, reuses the money path, marks executed, and returns the booking', async () => {
    const sb = makeSupabase({ proposal: bookingProposal, claimed: [{ id: 'p1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(prepareInboxBookingBody).mockResolvedValue({ ok: true, body: PREP_BODY } as never)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { booking_id: 'OC-123' } }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book' }), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { booking: { booking_id: 'OC-123' } } })

    // Prep got the proposal's booking + the conversation's contact.
    expect(prepareInboxBookingBody).toHaveBeenCalledWith(bookingProposal.payload.booking, bookingProposal.conversation.contact)

    // Money path reused verbatim — POST to /booking-flow/book, admin cookie forwarded, exact prep body.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:3000/api/admin/booking-flow/book')
    expect(init.method).toBe('POST')
    expect(init.headers.cookie).toBe('sb-access=secret')
    expect(JSON.parse(init.body)).toEqual(PREP_BODY)

    // State machine: shadow→booking (claim) then →executed (finalize), in that order.
    expect(sb.updates[0].status).toBe('booking')
    expect(sb.updates[sb.updates.length - 1].status).toBe('executed')
    expect((sb.updates[sb.updates.length - 1].outcome as { booking: unknown }).booking).toEqual({ booking_id: 'OC-123' })
  })
})

describe('POST book action — guards (no real booking fires)', () => {
  it('returns 409 and never prepares/books an already-executed proposal', async () => {
    const sb = makeSupabase({ proposal: { ...bookingProposal, status: 'executed' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book' }), PARAMS)
    expect(res.status).toBe(409)
    expect(prepareInboxBookingBody).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0) // no claim attempted
  })

  it('returns 400 for a non-booking proposal and never books', async () => {
    const sb = makeSupabase({ proposal: { ...bookingProposal, kind: 'reply_draft' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book' }), PARAMS)
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 422 (and never books) when the slot can no longer be prepared', async () => {
    const sb = makeSupabase({ proposal: bookingProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(prepareInboxBookingBody).mockResolvedValue({ ok: false, error: 'That slot is no longer available' } as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book' }), PARAMS)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('no longer available')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0) // claim not attempted when prep fails
  })

  it('returns 409 and DOES NOT book when the atomic claim matches zero rows (concurrent click)', async () => {
    // The whole point of the claim: a second request gets [] back and must abort
    // BEFORE touching FareHarbor — the double-booking guard.
    const sb = makeSupabase({ proposal: bookingProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(prepareInboxBookingBody).mockResolvedValue({ ok: true, body: PREP_BODY } as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book' }), PARAMS)
    expect(res.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled() // never reached the money path
    expect(sb.updates[0].status).toBe('booking') // claim was attempted (and lost)
    expect(sb.updates.some(u => u.status === 'executed')).toBe(false)
  })
})

describe('POST book action — failure releases the claim for retry', () => {
  it('releases shadow and returns 502 when FareHarbor rejects the booking', async () => {
    const sb = makeSupabase({ proposal: bookingProposal, claimed: [{ id: 'p1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(prepareInboxBookingBody).mockResolvedValue({ ok: true, body: PREP_BODY } as never)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: 'Sold out' }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book' }), PARAMS)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Sold out')
    // claimed 'booking', then released back to 'shadow'; never 'executed'.
    expect(sb.updates.map(u => u.status)).toEqual(['booking', 'shadow'])
  })

  it('releases shadow when the money-path fetch throws', async () => {
    const sb = makeSupabase({ proposal: bookingProposal, claimed: [{ id: 'p1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(prepareInboxBookingBody).mockResolvedValue({ ok: true, body: PREP_BODY } as never)
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book' }), PARAMS)
    expect(res.status).toBe(500)
    expect(sb.updates.map(u => u.status)).toEqual(['booking', 'shadow']) // released for retry
    expect(sb.updates.some(u => u.status === 'executed')).toBe(false)
  })
})

describe('POST book action — booking a validated alternative', () => {
  const proposalWithAlts = {
    ...bookingProposal,
    payload: {
      booking: { listing_slug: 'private-hidden-gems-cruise', date: '2026-06-20', time: '5pm', guests: 4 },
      verdict: {
        is_bookable: false,
        error: 'sold out',
        alternatives: [
          { date: '2026-06-20', time: '6pm', option: 'Diana - 2 Hours', boat_id: 'diana', kind: 'same_day_later', listing_slug: 'private-hidden-gems-cruise', listing_title: 'X', guests: 4, price_eur: 400, price_is_quote: true, avail_pk: 101, customer_type_rate_pk: 1101 },
        ],
      },
    },
  }

  it('re-derives the booking from the STORED alternative (not client input) and books it', async () => {
    const sb = makeSupabase({ proposal: proposalWithAlts, claimed: [{ id: 'p1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(prepareInboxBookingBody).mockResolvedValue({ ok: true, body: PREP_BODY } as never)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { booking_id: 'OC-ALT' } }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book', alternative_index: 0 }), PARAMS)
    expect(res.status).toBe(200)
    // Booked the ALTERNATIVE (6pm), re-resolved server-side from the stored payload.
    expect(prepareInboxBookingBody).toHaveBeenCalledWith(
      { listing_slug: 'private-hidden-gems-cruise', date: '2026-06-20', time: '6pm', guests: 4, option: 'Diana - 2 Hours' },
      proposalWithAlts.conversation.contact,
    )
    expect(sb.updates[sb.updates.length - 1].status).toBe('executed')
  })

  it('returns 422 (no claim, no booking) for an out-of-range alternative index', async () => {
    const sb = makeSupabase({ proposal: proposalWithAlts, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'book', alternative_index: 7 }), PARAMS)
    expect(res.status).toBe(422)
    expect(prepareInboxBookingBody).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0) // never claimed
  })
})

// ── send action — the maintenance technician email ───────────────────────────

describe('POST send action — maintenance technician email', () => {
  const maintenanceProposal = {
    id: 'm1',
    kind: 'maintenance_task',
    status: 'shadow',
    payload: {
      maintenance_task_id: 't1',
      email_subject: 'Quote request: cracked seat cushion on Diana',
      email_body: 'Hi, the port-side bench on Diana is cracked. Could you send an estimate? Thanks, Off Course Amsterdam',
      recipient: 'handyman@example.com',
    },
  }

  it('claims, sends the email, marks executed, and returns dispatched', async () => {
    const sb = makeSupabase({ proposal: maintenanceProposal, claimed: [{ id: 'm1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendMaintenanceEmail).mockResolvedValue(true)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { dispatched: true, recipient: 'handyman@example.com' } })

    // Sent the drafted email to the configured recipient.
    expect(sendMaintenanceEmail).toHaveBeenCalledWith({
      recipient: 'handyman@example.com',
      subject: maintenanceProposal.payload.email_subject,
      body: maintenanceProposal.payload.email_body,
    })
    // State machine: shadow→sending (claim) then →executed.
    expect(sb.updates[0].status).toBe('sending')
    expect(sb.updates.some(u => u.status === 'executed')).toBe(true)
    // Board record stamped with the emailed timestamp.
    expect(sb.updates.some(u => 'technician_emailed_at' in u)).toBe(true)
  })

  it('releases the claim and 503s (never fakes "sent") when no email was dispatched', async () => {
    // sendMaintenanceEmail returns false when RESEND_API_KEY is absent — nothing
    // went out, so the proposal must NOT be marked executed (that would fake
    // success AND permanently block retry).
    const sb = makeSupabase({ proposal: maintenanceProposal, claimed: [{ id: 'm1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendMaintenanceEmail).mockResolvedValue(false)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(503)
    expect(sb.updates.map(u => u.status)).toEqual(['sending', 'shadow']) // claimed then released
    expect(sb.updates.some(u => u.status === 'executed')).toBe(false)
    expect(sb.updates.some(u => 'technician_emailed_at' in u)).toBe(false) // task not stamped
  })

  it('returns 409 and never sends an already-executed proposal', async () => {
    const sb = makeSupabase({ proposal: { ...maintenanceProposal, status: 'executed' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(409)
    expect(sendMaintenanceEmail).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0) // no claim attempted
  })

  it('returns 400 for a non-maintenance proposal', async () => {
    const sb = makeSupabase({ proposal: { ...maintenanceProposal, kind: 'reply_draft' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(400)
    expect(sendMaintenanceEmail).not.toHaveBeenCalled()
  })

  it('returns 422 (no claim) when the proposal has no drafted email', async () => {
    const sb = makeSupabase({
      proposal: { ...maintenanceProposal, payload: { maintenance_task_id: 't1', recipient: 'handyman@example.com' } },
      claimed: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(422)
    expect(sendMaintenanceEmail).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0)
  })

  it('returns 400 (no claim) when no recipient is configured anywhere', async () => {
    delete process.env.MAINTENANCE_EMAIL_RECIPIENT
    const sb = makeSupabase({
      proposal: { ...maintenanceProposal, payload: { ...maintenanceProposal.payload, recipient: null } },
      claimed: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(400)
    expect(sendMaintenanceEmail).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0)
  })

  it('returns 409 and DOES NOT send when the atomic claim matches zero rows (concurrent click)', async () => {
    const sb = makeSupabase({ proposal: maintenanceProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendMaintenanceEmail).mockResolvedValue(true)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(409)
    expect(sendMaintenanceEmail).not.toHaveBeenCalled() // never reached the send
    expect(sb.updates[0].status).toBe('sending') // claim attempted (and lost)
    expect(sb.updates.some(u => u.status === 'executed')).toBe(false)
  })

  it('releases the claim back to shadow when sending throws', async () => {
    const sb = makeSupabase({ proposal: maintenanceProposal, claimed: [{ id: 'm1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendMaintenanceEmail).mockRejectedValue(new Error('resend down'))

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(500)
    // claimed 'sending', then released back to 'shadow'; never 'executed'.
    expect(sb.updates.map(u => u.status)).toEqual(['sending', 'shadow'])
  })
})

// ── send action — the stock reorder supplier email (shares the send branch) ──

describe('POST send action — stock reorder supplier email', () => {
  const stockProposal = {
    id: 's1',
    kind: 'stock_reorder',
    status: 'shadow',
    payload: {
      item_ids: ['i1', 'i2'],
      email_subject: 'Restock order — Off Course Amsterdam',
      email_body: 'Hi, could we reorder 24 trays of ice tea and 4 beer trays? Thanks, Off Course Amsterdam',
      recipient: null, // forces the STOCK_EMAIL_RECIPIENT fallback
    },
  }

  beforeEach(() => {
    process.env.STOCK_EMAIL_RECIPIENT = 'supplier@example.com'
  })

  it('falls back to STOCK_EMAIL_RECIPIENT, sends, stamps the ordered items, returns dispatched', async () => {
    const sb = makeSupabase({ proposal: stockProposal, claimed: [{ id: 's1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendMaintenanceEmail).mockResolvedValue(true)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { dispatched: true, recipient: 'supplier@example.com' } })

    expect(sendMaintenanceEmail).toHaveBeenCalledWith({
      recipient: 'supplier@example.com', // per-item recipient null → env fallback
      subject: stockProposal.payload.email_subject,
      body: stockProposal.payload.email_body,
    })
    // shadow→sending (claim) then →executed, and the ordered items get stamped.
    expect(sb.updates[0].status).toBe('sending')
    expect(sb.updates.some(u => u.status === 'executed')).toBe(true)
    expect(sb.updates.some(u => 'last_reordered_at' in u)).toBe(true)
  })

  it('returns 400 naming STOCK_EMAIL_RECIPIENT when no recipient is configured anywhere', async () => {
    delete process.env.STOCK_EMAIL_RECIPIENT
    const sb = makeSupabase({ proposal: stockProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('STOCK_EMAIL_RECIPIENT')
    expect(sendMaintenanceEmail).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0) // no claim attempted
  })

  it('releases the claim and 503s (never stamps items) when nothing was dispatched', async () => {
    const sb = makeSupabase({ proposal: stockProposal, claimed: [{ id: 's1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendMaintenanceEmail).mockResolvedValue(false)

    const res = await POST(makeReq({ action: 'send' }), PARAMS)
    expect(res.status).toBe(503)
    expect(sb.updates.map(u => u.status)).toEqual(['sending', 'shadow']) // claimed then released
    expect(sb.updates.some(u => 'last_reordered_at' in u)).toBe(false) // items not stamped
  })
})

// ── correct_booking action — patch a typo'd contact field + resend confirmation ──

/**
 * correct_booking touches TWO tables (agent_proposals for the claim/state
 * machine, bookings for the actual patch), unlike book/send which only touch
 * agent_proposals — so this needs its own table-aware stub instead of the
 * shared makeSupabase() above.
 */
function makeCorrectionSupabase({
  proposal,
  claimed,
  booking,
}: {
  proposal: unknown
  claimed: unknown[]
  booking?: unknown
}) {
  const updates: { agent_proposals: Array<Record<string, unknown>>; bookings: Array<Record<string, unknown>> } = {
    agent_proposals: [],
    bookings: [],
  }

  function agentProposalsBuilder() {
    let pending: Record<string, unknown> | null = null
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      single: async () => ({ data: proposal }),
      update: (payload: Record<string, unknown>) => {
        pending = payload
        updates.agent_proposals.push(payload)
        return builder
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const isClaim = pending?.status === 'booking'
        const result = isClaim ? { data: claimed } : { data: null, error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return builder
  }

  function bookingsBuilder() {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      single: async () => ({ data: booking ?? null }),
      update: (payload: Record<string, unknown>) => {
        updates.bookings.push(payload)
        return builder
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
    }
    return builder
  }

  const from = vi.fn((table: string) => (table === 'bookings' ? bookingsBuilder() : agentProposalsBuilder()))
  return { client: { from }, updates }
}

const correctionProposal = {
  id: 'c1',
  kind: 'booking_correction',
  status: 'shadow',
  payload: { correction: { booking_id: 'bk-1', field: 'customer_email', new_value: 'suha@gmx.net' } },
}

const matchedBooking = {
  id: 'bk-1',
  booking_uuid: 'fh-uuid-1',
  customer_name: 'Susanne Hartmann',
  customer_email: 'typo@gmx.net',
  customer_phone: '+31600000000',
  listing_title: 'Private Hidden Gems Cruise',
  booking_date: '2026-08-10',
  start_time: '2026-08-10T13:00:00+00:00',
  end_time: '2026-08-10T15:00:00+00:00',
  guest_count: 2,
  category: 'private',
  extras_selected: [],
  stripe_amount: 20000,
  fareharbor_customer_type_rate_pk: 1,
  stripe_payment_intent_id: 'pi_1',
  base_amount_cents: 20000,
  discount_amount_cents: 0,
}

describe('POST correct_booking action — happy path', () => {
  it('claims, patches the email, resends the confirmation, marks executed', async () => {
    const sb = makeCorrectionSupabase({ proposal: correctionProposal, claimed: [{ id: 'c1' }], booking: matchedBooking })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendConfirmationEmail).mockResolvedValue(true)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { booking_id: 'bk-1', new_email: 'suha@gmx.net' } })

    // The booking's email got patched — nothing else on the row.
    expect(sb.updates.bookings).toEqual([{ customer_email: 'suha@gmx.net' }])

    // Confirmation resent to the CORRECTED address, with the real booking's details.
    expect(sendConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: expect.objectContaining({ name: 'Susanne Hartmann', email: 'suha@gmx.net' }),
        listingTitle: 'Private Hidden Gems Cruise',
        guestCount: 2,
      }),
    )

    // State machine: shadow→booking (claim) then →executed; never left mid-flight.
    expect(sb.updates.agent_proposals[0].status).toBe('booking')
    expect(sb.updates.agent_proposals[sb.updates.agent_proposals.length - 1].status).toBe('executed')
    expect(emitOpsEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'recommendation_approved' }))
  })
})

describe('POST correct_booking action — guards (no real change fires)', () => {
  it('returns 403 and touches nothing when the kind is below the ask level', async () => {
    vi.mocked(autonomyForKind).mockReturnValueOnce('propose')
    const sb = makeCorrectionSupabase({ proposal: correctionProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
    expect(sb.updates.agent_proposals).toHaveLength(0)
    expect(sendConfirmationEmail).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-correction proposal', async () => {
    const sb = makeCorrectionSupabase({ proposal: { ...correctionProposal, kind: 'reply_draft' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(400)
    expect(sendConfirmationEmail).not.toHaveBeenCalled()
  })

  it('returns 409 and never re-applies an already-executed correction', async () => {
    const sb = makeCorrectionSupabase({ proposal: { ...correctionProposal, status: 'executed' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(sb.updates.agent_proposals).toHaveLength(0) // no claim attempted
  })

  it('returns 422 (no claim) when the stored correction is missing required fields', async () => {
    const sb = makeCorrectionSupabase({
      proposal: { ...correctionProposal, payload: { correction: { booking_id: 'bk-1', field: 'customer_email' } } },
      claimed: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(422)
    expect(sb.updates.agent_proposals).toHaveLength(0)
  })

  it('returns 422 (no claim) when the corrected email address looks invalid', async () => {
    const sb = makeCorrectionSupabase({
      proposal: {
        ...correctionProposal,
        payload: { correction: { booking_id: 'bk-1', field: 'customer_email', new_value: 'not-an-email' } },
      },
      claimed: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(422)
    expect(sb.updates.agent_proposals).toHaveLength(0)
  })

  it('returns 409 and applies nothing when the atomic claim matches zero rows (concurrent click)', async () => {
    // The booking itself is valid — this test is specifically about losing the
    // claim race, which only happens once validation (booking exists, not
    // cancelled) has already passed.
    const sb = makeCorrectionSupabase({ proposal: correctionProposal, claimed: [], booking: matchedBooking })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(sb.updates.agent_proposals[0].status).toBe('booking') // claim was attempted (and lost)
    expect(sendConfirmationEmail).not.toHaveBeenCalled()
  })

  it('returns 404 without ever claiming when the matched booking no longer exists', async () => {
    // Booking validation now happens BEFORE the atomic claim (same ordering
    // as the `book` action) — a missing booking is a pure read failure, so
    // there's no claim to take or release.
    const sb = makeCorrectionSupabase({ proposal: correctionProposal, claimed: [{ id: 'c1' }], booking: null })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(404)
    expect(sb.updates.agent_proposals).toHaveLength(0)
    expect(sendConfirmationEmail).not.toHaveBeenCalled()
  })
})

describe('POST correct_booking action — failure releases the claim for retry', () => {
  it('releases shadow and 500s when the confirmation email fails to send', async () => {
    // sendConfirmationEmail never rejects in production (RESEND_API_KEY missing,
    // Resend down, etc. all resolve to false) — this is the real shape a
    // failure takes, not a thrown error.
    const sb = makeCorrectionSupabase({ proposal: correctionProposal, claimed: [{ id: 'c1' }], booking: matchedBooking })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendConfirmationEmail).mockResolvedValue(false)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(500)
    // claimed 'booking', then released back to 'shadow'; the email patch itself
    // already went through (the code doesn't roll that back on email failure).
    expect(sb.updates.agent_proposals.map(u => u.status)).toEqual(['booking', 'shadow'])
    expect(sb.updates.agent_proposals.some(u => u.status === 'executed')).toBe(false)
  })

  it('returns 409 without ever claiming, patching, or emailing when the matched booking is cancelled', async () => {
    // Same pre-claim-validation ordering as the missing-booking case above.
    const sb = makeCorrectionSupabase({
      proposal: correctionProposal,
      claimed: [{ id: 'c1' }],
      booking: { ...matchedBooking, status: 'cancelled' },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'correct_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(sb.updates.agent_proposals).toHaveLength(0)
    expect(sb.updates.bookings).toHaveLength(0)
    expect(sendConfirmationEmail).not.toHaveBeenCalled()
  })
})

// ── import_fh_booking action — pull an already-real FareHarbor booking into our own database ──

const importProposal = {
  id: 'i1',
  kind: 'fh_booking_import_ready',
  status: 'shadow',
  conversation_id: 'conv-1',
  payload: {
    platform: 'getyourguide',
    bookingRef: '369057638',
    guestName: 'shoshana mccallum',
    guestEmail: 'customer-xzxhygwncrx37du3@reply.getyourguide.com',
    guestPhone: '+64 21 248 0388',
    endTime: '18:30',
    parsed: { dateISO: '2026-08-05', time: '17:00', guests: 2, experienceName: 'Shared Cruise' },
  },
}

describe('POST import_fh_booking action — happy path', () => {
  it('claims, imports via FareHarbor, marks executed, and syncs shifts for that date', async () => {
    const sb = makeSupabase({ proposal: importProposal, claimed: [{ id: 'i1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(importFareharborBooking).mockResolvedValue({ ok: true, bookingId: 'bk-99', date: '2026-08-05' })

    const res = await POST(makeReq({ action: 'import_fh_booking' }), { params: Promise.resolve({ id: 'i1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { booking_id: 'bk-99' } })

    // Built straight from the proposal's own payload — pk parsed from
    // bookingRef, everything else passed through as-is.
    expect(importFareharborBooking).toHaveBeenCalledWith(sb.client, {
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
    })

    // Newly-imported booking flows into Scheduling immediately, same hook every
    // other booking-confirmation path uses.
    expect(syncShiftsForRange).toHaveBeenCalledWith(sb.client, '2026-08-05', '2026-08-05')

    // State machine: shadow→booking (claim) then →executed; never left mid-flight.
    expect(sb.updates[0].status).toBe('booking')
    expect(sb.updates[1].status).toBe('executed')
    expect(emitOpsEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'recommendation_approved' }))

    // The conversation itself flips too — not just the proposal — so the
    // inbox list and thread header stop showing "Not in our database" the
    // moment this resolves, without waiting on any other process.
    expect(sb.updates[2]).toEqual({
      ota_status: 'imported',
      status: 'resolved',
      ai_summary: 'Imported — booking #369057638 now in Bookings, Scheduling and Planning.',
    })

    // Planning/Bookings pages already open must refetch immediately instead
    // of showing this import until a manual reload.
    expect(notifyBookingsChanged).toHaveBeenCalled()
  })
})

describe('POST import_fh_booking action — guards (no import fires)', () => {
  it('returns 400 for a non-import proposal', async () => {
    const sb = makeSupabase({ proposal: { ...importProposal, kind: 'ota_booking_ready' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'import_fh_booking' }), { params: Promise.resolve({ id: 'i1' }) })
    expect(res.status).toBe(400)
    expect(importFareharborBooking).not.toHaveBeenCalled()
  })

  it('returns 409 and never re-imports an already-executed proposal', async () => {
    const sb = makeSupabase({ proposal: { ...importProposal, status: 'executed' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'import_fh_booking' }), { params: Promise.resolve({ id: 'i1' }) })
    expect(res.status).toBe(409)
    expect(importFareharborBooking).not.toHaveBeenCalled()
  })

  it('returns 409 on a double-click race — second request finds zero rows to claim', async () => {
    const sb = makeSupabase({ proposal: importProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'import_fh_booking' }), { params: Promise.resolve({ id: 'i1' }) })
    expect(res.status).toBe(409)
    expect(importFareharborBooking).not.toHaveBeenCalled()
  })

  it('returns 422 for a proposal with no valid FareHarbor booking number', async () => {
    const sb = makeSupabase({ proposal: { ...importProposal, payload: { ...importProposal.payload, bookingRef: undefined } }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'import_fh_booking' }), { params: Promise.resolve({ id: 'i1' }) })
    expect(res.status).toBe(422)
    expect(importFareharborBooking).not.toHaveBeenCalled()
  })
})

describe('POST import_fh_booking action — failure releases the claim for retry', () => {
  it('releases shadow and reports the reason when FareHarbor has no matching booking', async () => {
    const sb = makeSupabase({ proposal: importProposal, claimed: [{ id: 'i1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(importFareharborBooking).mockResolvedValue({ ok: false, error: 'Booking #369057638 was not found in FareHarbor on 2026-08-05.' })

    const res = await POST(makeReq({ action: 'import_fh_booking' }), { params: Promise.resolve({ id: 'i1' }) })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('was not found in FareHarbor')
    expect(sb.updates.map(u => u.status)).toEqual(['booking', 'shadow'])
    expect(syncShiftsForRange).not.toHaveBeenCalled()
  })
})

// ── cancel_booking action — cancel a cruise + refund via the existing money path ──

const cancellationProposal = {
  id: 'c1',
  kind: 'cancellation_request',
  status: 'shadow',
  payload: { cancellation: { booking_id: 'bk-1' }, reply: "No problem, we'll cancel that for you." },
}

const FULL_REFUND_TERMS = {
  bookingId: 'bk-1',
  bookingFound: true,
  guestName: 'Paul Kehoe',
  listingTitle: 'Private Hidden Gems Cruise',
  departureAt: '2026-09-12T15:00:00.000Z',
  hoursUntilDeparture: 51,
  refundPercent: 100,
  amountPaidCents: 31000,
  refundCents: 31000,
  policySummary: '51h before departure → full refund tier (100%)',
  bookingSource: 'website',
  isOtaBooking: false,
  alreadyCancelled: false,
  canCancelInFareharbor: true,
}

describe('POST cancel_booking action — happy path', () => {
  it('claims, recomputes terms fresh, cancels via the existing money path with the recomputed €, and marks executed', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [{ id: 'c1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue(FULL_REFUND_TERMS)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { cancelled: true } }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { cancelled: true, refund_cents: 31000 } })

    // Terms were recomputed for THIS booking — never read off the stored payload.
    expect(computeCancellationTerms).toHaveBeenCalledWith('bk-1', sb.client)

    // Reused the existing, already-guarded cancel route verbatim.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://localhost:3000/api/admin/bookings/bk-1/cancel')
    expect(init.method).toBe('POST')
    expect(init.headers.cookie).toBe('sb-access=secret')
    // 100% tier → 'partial' at the FULL computed amount, never the blind 'full'
    // option (which would refund stripe_amount regardless of tier).
    expect(JSON.parse(init.body)).toEqual({ refundOption: 'partial', partialAmountCents: 31000 })

    expect(sb.updates[0].status).toBe('booking')
    expect(sb.updates[sb.updates.length - 1].status).toBe('executed')
    expect((sb.updates[sb.updates.length - 1].outcome as { refund_cents: number }).refund_cents).toBe(31000)
  })

  it('uses a partial refund at a 50% tier, never the blind "full" option', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [{ id: 'c1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue({ ...FULL_REFUND_TERMS, refundPercent: 50, refundCents: 15500 })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { cancelled: true } }) })
    vi.stubGlobal('fetch', fetchMock)

    await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ refundOption: 'partial', partialAmountCents: 15500 })
  })

  it('skips the refund call entirely at a 0% tier', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [{ id: 'c1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue({ ...FULL_REFUND_TERMS, refundPercent: 0, refundCents: 0 })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { cancelled: true } }) })
    vi.stubGlobal('fetch', fetchMock)

    await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ refundOption: 'none' })
  })

  it('honours an explicit "no refund" override even when policy would suggest one', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [{ id: 'c1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue(FULL_REFUND_TERMS) // 100%, €310
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { cancelled: true } }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking', refundOption: 'none' }), { params: Promise.resolve({ id: 'c1' }) })

    expect((await res.json()).data.refund_cents).toBe(0)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ refundOption: 'none' })
  })
})

describe('POST cancel_booking action — guards (no real cancellation fires)', () => {
  it('returns 400 for a non-cancellation proposal', async () => {
    const sb = makeSupabase({ proposal: { ...cancellationProposal, kind: 'reply_draft' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(400)
    expect(computeCancellationTerms).not.toHaveBeenCalled()
  })

  it('returns 409 and never cancels an already-executed proposal', async () => {
    const sb = makeSupabase({ proposal: { ...cancellationProposal, status: 'executed' }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(computeCancellationTerms).not.toHaveBeenCalled()
  })

  it('refuses an OTA booking — that platform holds the customer relationship', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue({ ...FULL_REFUND_TERMS, isOtaBooking: true, bookingSource: 'getyourguide' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('getyourguide')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0) // never even claimed
  })

  it('refuses when there is no FareHarbor reference to cancel with', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue({ ...FULL_REFUND_TERMS, canCancelInFareharbor: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sb.updates).toHaveLength(0)
  })

  it('refuses when the booking is already cancelled', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue({ ...FULL_REFUND_TERMS, alreadyCancelled: true })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 422 (no claim, no computeCancellationTerms call) when the proposal has no booking_id', async () => {
    const sb = makeSupabase({ proposal: { ...cancellationProposal, payload: { reply: 'hi' } }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(422)
    expect(computeCancellationTerms).not.toHaveBeenCalled()
  })

  it('returns 404 when the booking no longer exists', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue({ ...FULL_REFUND_TERMS, bookingFound: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 409 and DOES NOT cancel when the atomic claim matches zero rows (concurrent click)', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue(FULL_REFUND_TERMS)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled() // never reached the money path
    expect(sb.updates[0].status).toBe('booking') // claim was attempted (and lost)
  })
})

describe('POST cancel_booking action — failure releases the claim for retry', () => {
  it('releases shadow and reports the reason when the cancel route rejects it', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [{ id: 'c1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue(FULL_REFUND_TERMS)
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: 'Already refunded' }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Already refunded')
    expect(sb.updates.map(u => u.status)).toEqual(['booking', 'shadow'])
  })

  it('releases shadow when the cancel route fetch throws', async () => {
    const sb = makeSupabase({ proposal: cancellationProposal, claimed: [{ id: 'c1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(computeCancellationTerms).mockResolvedValue(FULL_REFUND_TERMS)
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ action: 'cancel_booking' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(500)
    expect(sb.updates.map(u => u.status)).toEqual(['booking', 'shadow'])
  })
})

const acceptedMoveProposal = {
  id: 'm1',
  kind: 'guest_move_request',
  payload: { target_date: '2026-08-25', guest_name: 'Sophie Russell', cruise_title: 'Hidden Gems Cruise' },
  outcome: { guest_response: 'accept', responded_at: '2026-08-24T10:00:00Z' },
}

const crossDayAcceptedMoveProposal = {
  ...acceptedMoveProposal,
  id: 'm2',
  payload: { ...acceptedMoveProposal.payload, to_date: '2026-08-26' },
}

describe('POST mark_rebooked action', () => {
  it('records rebooked_at, resyncs every affected date, and never touches FareHarbor itself', async () => {
    const sb = makeSupabase({ proposal: crossDayAcceptedMoveProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'mark_rebooked' }), { params: Promise.resolve({ id: 'm2' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.data.rebooked_at).toBe('string')

    expect(sb.updates).toHaveLength(1)
    expect(sb.updates[0].outcome).toMatchObject({ guest_response: 'accept', rebooked_at: expect.any(String) })

    // Both the from-date and the cross-day to-date get resynced — nothing
    // here calls FareHarbor directly, only our own shift/schedule tables.
    expect(syncShiftsForRange).toHaveBeenCalledWith(sb.client, '2026-08-25', '2026-08-25')
    expect(syncShiftsForRange).toHaveBeenCalledWith(sb.client, '2026-08-26', '2026-08-26')

    expect(emitOpsEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'guest_move_rebooked', proposalId: 'm2' }))
    expect(notifyBookingsChanged).toHaveBeenCalled()
  })

  it('resyncs only the one date for a same-day move (no to_date on the payload)', async () => {
    const sb = makeSupabase({ proposal: acceptedMoveProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await POST(makeReq({ action: 'mark_rebooked' }), { params: Promise.resolve({ id: 'm1' }) })

    expect(syncShiftsForRange).toHaveBeenCalledTimes(1)
    expect(syncShiftsForRange).toHaveBeenCalledWith(sb.client, '2026-08-25', '2026-08-25')
  })

  it('returns 400 for a non-move proposal', async () => {
    const sb = makeSupabase({ proposal: bookingProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'mark_rebooked' }), PARAMS)
    expect(res.status).toBe(400)
    expect(sb.updates).toHaveLength(0)
  })

  it('refuses when the guest has not accepted yet', async () => {
    const sb = makeSupabase({
      proposal: { ...acceptedMoveProposal, outcome: { guest_response: 'defer' } },
      claimed: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'mark_rebooked' }), { params: Promise.resolve({ id: 'm1' }) })
    expect(res.status).toBe(409)
    expect(sb.updates).toHaveLength(0)
    expect(syncShiftsForRange).not.toHaveBeenCalled()
  })

  it('refuses a second mark_rebooked — already recorded', async () => {
    const sb = makeSupabase({
      proposal: { ...acceptedMoveProposal, outcome: { guest_response: 'accept', rebooked_at: '2026-08-24T12:00:00Z' } },
      claimed: [],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'mark_rebooked' }), { params: Promise.resolve({ id: 'm1' }) })
    expect(res.status).toBe(409)
    expect(sb.updates).toHaveLength(0)
  })
})

describe('POST confirm_upsell_bonus action (Beer, 2026-08-24: "an ai reading the incoming information... in the payroll tab we have an upsell review environment")', () => {
  const upsellProposal = { id: 'u1', kind: 'upsell_bonus', status: 'shadow', payload: { staff_id: 'bas', extra_minutes: 30, amount_charged_cents: 2000 } }

  it('claims, creates the real extra_hours_bonuses row with the submitted (possibly human-corrected) fields, and marks executed', async () => {
    const sb = makeSupabase({ proposal: upsellProposal, claimed: [{ id: 'u1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(
      makeReq({ action: 'confirm_upsell_bonus', staff_id: 'bas', date: '2026-08-24', extra_minutes: 45, amount_charged_cents: 3000 }),
      { params: Promise.resolve({ id: 'u1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.extra_hours_bonus_id).toBe('bonus1')

    expect(sb.inserts).toHaveLength(1)
    expect(sb.inserts[0]).toMatchObject({
      table: 'extra_hours_bonuses',
      row: { staff_id: 'bas', date: '2026-08-24', extra_minutes: 45, amount_charged_cents: 3000, commission_cents: 1500 },
    })

    // Claim then finalize — 'confirming' first, 'executed' only after the insert succeeds.
    expect(sb.updates[0]).toMatchObject({ status: 'confirming' })
    expect(sb.updates.at(-1)).toMatchObject({ status: 'executed', outcome: expect.objectContaining({ extra_hours_bonus_id: 'bonus1' }) })
  })

  it('returns 400 for a non-upsell proposal', async () => {
    const sb = makeSupabase({ proposal: bookingProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(
      makeReq({ action: 'confirm_upsell_bonus', staff_id: 'bas', date: '2026-08-24', extra_minutes: 30, amount_charged_cents: 2000 }),
      { params: Promise.resolve({ id: 'p1' }) },
    )
    expect(res.status).toBe(400)
    expect(sb.inserts).toHaveLength(0)
  })

  it('rejects a missing field before ever claiming', async () => {
    const sb = makeSupabase({ proposal: upsellProposal, claimed: [{ id: 'u1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(
      makeReq({ action: 'confirm_upsell_bonus', staff_id: 'bas', date: '2026-08-24', amount_charged_cents: 2000 }),
      { params: Promise.resolve({ id: 'u1' }) },
    )
    expect(res.status).toBe(400)
    expect(sb.updates).toHaveLength(0)
    expect(sb.inserts).toHaveLength(0)
  })

  it('surfaces a real DB error from the claim as 500, not a misleading 409 "already confirmed" (caught live: an unlisted status value hit a CHECK constraint and was silently read as a lost race)', async () => {
    const sb = makeSupabase({ proposal: upsellProposal, claimed: [], claimError: { message: 'violates check constraint "agent_proposals_status_check"' } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(
      makeReq({ action: 'confirm_upsell_bonus', staff_id: 'bas', date: '2026-08-24', extra_minutes: 30, amount_charged_cents: 2000 }),
      { params: Promise.resolve({ id: 'u1' }) },
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('check constraint')
    expect(sb.inserts).toHaveLength(0)
  })

  it('refuses a second confirm — already resolved', async () => {
    const sb = makeSupabase({ proposal: upsellProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(
      makeReq({ action: 'confirm_upsell_bonus', staff_id: 'bas', date: '2026-08-24', extra_minutes: 30, amount_charged_cents: 2000 }),
      { params: Promise.resolve({ id: 'u1' }) },
    )
    expect(res.status).toBe(409)
    expect(sb.inserts).toHaveLength(0)
  })

  it('releases the claim back to shadow if creating the bonus row fails', async () => {
    const sb = makeSupabase({ proposal: upsellProposal, claimed: [{ id: 'u1' }], insertError: { message: 'constraint violation' } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(
      makeReq({ action: 'confirm_upsell_bonus', staff_id: 'bas', date: '2026-08-24', extra_minutes: 30, amount_charged_cents: 2000 }),
      { params: Promise.resolve({ id: 'u1' }) },
    )
    expect(res.status).toBe(500)
    expect(sb.updates.at(-1)).toMatchObject({ status: 'shadow' })
  })
})

describe('POST reject_upsell_bonus action', () => {
  const upsellProposal = { id: 'u1', kind: 'upsell_bonus', status: 'shadow', payload: {} }

  it('marks the proposal skipped and creates nothing', async () => {
    const sb = makeSupabase({ proposal: upsellProposal, claimed: [{ id: 'u1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'reject_upsell_bonus' }), { params: Promise.resolve({ id: 'u1' }) })
    expect(res.status).toBe(200)
    expect(sb.inserts).toHaveLength(0)
    expect(sb.updates[0]).toMatchObject({ status: 'skipped' })
  })

  it('returns 400 for a non-upsell proposal', async () => {
    const sb = makeSupabase({ proposal: bookingProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'reject_upsell_bonus' }), { params: Promise.resolve({ id: 'p1' }) })
    expect(res.status).toBe(400)
  })

  it('refuses a second reject — already resolved', async () => {
    const sb = makeSupabase({ proposal: upsellProposal, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'reject_upsell_bonus' }), { params: Promise.resolve({ id: 'u1' }) })
    expect(res.status).toBe(409)
  })
})

describe('POST send_move action — SMS-first, email only as a no-phone fallback (Beer, 2026-08-23)', () => {
  const smsOnlyProposal = {
    id: 's1',
    kind: 'guest_move_request',
    status: 'shadow',
    payload: {
      guest_name: 'Sophie Russell',
      guest_email: 'sophie@example.com',
      guest_phone: '+31600000000',
      sms_text: 'Hi Sophie! {{link}}',
    },
  }
  const emailOnlyProposal = {
    id: 's2',
    kind: 'guest_move_request',
    status: 'shadow',
    payload: {
      guest_name: 'No Phone Guest',
      guest_email: 'nophone@example.com',
      guest_phone: null,
      email_subject: 'Quick question',
      email_body: 'Would this work? {{link}}',
    },
  }

  it('sends via SMS when the booking has a phone — never attempts email at all', async () => {
    const sb = makeSupabase({ proposal: smsOnlyProposal, claimed: [{ id: 's1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendSms).mockResolvedValue(true)

    const res = await POST(makeReq({ action: 'send_move' }), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { channels: ['sms'] } })

    expect(sendSms).toHaveBeenCalledTimes(1)
    const [toArg, bodyArg] = vi.mocked(sendSms).mock.calls[0]
    expect(toArg).toBe('+31600000000')
    expect(bodyArg).toContain('Hi Sophie!')
    expect(bodyArg).not.toContain('{{link}}') // the placeholder is always substituted before sending
    expect(sendMaintenanceEmail).not.toHaveBeenCalled()
    expect(sb.updates.at(-1)).toMatchObject({ status: 'approved', outcome: expect.objectContaining({ channels: ['sms'] }) })
  })

  it('falls back to email only when the booking has no phone at all', async () => {
    const sb = makeSupabase({ proposal: emailOnlyProposal, claimed: [{ id: 's2' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendMaintenanceEmail).mockResolvedValue(true)

    const res = await POST(makeReq({ action: 'send_move' }), { params: Promise.resolve({ id: 's2' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, data: { channels: ['email'] } })

    expect(sendMaintenanceEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'nophone@example.com', subject: 'Quick question' }),
    )
    expect(sendSms).not.toHaveBeenCalled()
  })

  it('does NOT fall back to email when SMS fails to send — reports the error instead of silently switching channels', async () => {
    const sb = makeSupabase({ proposal: smsOnlyProposal, claimed: [{ id: 's1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(sendSms).mockRejectedValue(new Error('Twilio 400: invalid number'))

    const res = await POST(makeReq({ action: 'send_move' }), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('Twilio 400')
    expect(sendMaintenanceEmail).not.toHaveBeenCalled()
    // Claim released back to 'shadow' so a retry is possible.
    expect(sb.updates.at(-1)).toMatchObject({ status: 'shadow' })
  })

  it('422s before ever claiming when the phone-having booking has no drafted SMS text', async () => {
    const sb = makeSupabase({ proposal: { ...smsOnlyProposal, payload: { ...smsOnlyProposal.payload, sms_text: undefined } }, claimed: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(makeReq({ action: 'send_move' }), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(422)
    expect(sb.updates).toHaveLength(0)
    expect(sendSms).not.toHaveBeenCalled()
  })
})
