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

import { POST } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import { prepareInboxBookingBody } from '@/lib/ghost/book-from-proposal'
import { sendMaintenanceEmail } from '@/lib/maintenance/send-email'

const PREP_BODY = { listingSlug: 'private-hidden-gems-cruise', availabilityPk: 9001, bookingSource: 'complimentary' }

/**
 * Route-shaped Supabase stub. `single()` returns the proposal; an `update()`
 * whose payload sets status:'booking' is the atomic claim and resolves to
 * `claimed` (the rows the conditional UPDATE matched); other updates resolve
 * empty. Every update payload is captured so we can assert the state machine.
 */
function makeSupabase({ proposal, claimed }: { proposal: unknown; claimed: unknown[] }) {
  const updates: Array<Record<string, unknown>> = []
  const from = vi.fn(() => {
    let pending: Record<string, unknown> | null = null
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      single: async () => ({ data: proposal }),
      update: (payload: Record<string, unknown>) => {
        pending = payload
        updates.push(payload)
        return builder
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        // Both transient claim statuses ('booking' for bookings, 'sending' for
        // maintenance emails) resolve to the matched rows; other updates empty.
        const isClaim = pending?.status === 'booking' || pending?.status === 'sending'
        const result = isClaim ? { data: claimed } : { data: null, error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return builder
  })
  return { client: { from }, from, updates }
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
