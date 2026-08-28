import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  fhValidate: vi.fn().mockResolvedValue({ is_bookable: true }),
  fhRebook: vi.fn().mockResolvedValue({ uuid: 'fh-new-uuid' }),
  fhCreate: vi.fn().mockResolvedValue({ uuid: 'fh-new-uuid' }),
  fhCancel: vi.fn().mockResolvedValue(undefined),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  sendRescheduleEmail: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    validateBooking: h.fhValidate,
    rebookBooking: h.fhRebook,
    createBooking: h.fhCreate,
    cancelBooking: h.fhCancel,
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: h.dbSelect }) }),
      update: () => ({ eq: h.dbUpdate }),
    }),
  }),
}))

vi.mock('@/lib/scheduling/proactive-scheduling', () => ({ syncAndScheduleShifts: vi.fn().mockResolvedValue(undefined) }))
// after() needs a real Next.js request scope, absent when calling POST directly
// in a unit test — run the callback inline instead.
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => cb() }
})
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendRescheduleEmail: h.sendRescheduleEmail }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText, postSlackOps: h.postSlackOps }))

import { POST } from './route'

const BOOKING = {
  id: 1,
  booking_uuid: 'old-fh-uuid',
  status: 'confirmed',
  customer_name: 'Enrico Test',
  customer_email: 'enrico@example.com',
  customer_phone: '+31600000000',
  guest_note: null,
  category: 'private',
  guest_count: 2,
  listing_title: 'Diana 2h Private',
  base_amount_cents: 16500,
  booking_date: '2026-06-25',
  start_time: '2026-06-25T12:00:00Z',
}

const BODY = {
  newAvailPk: 9001,
  newCustomerTypeRatePk: 8001,
  newCustomerTypeName: 'Diana 2h',
  newDate: '2026-06-27',
  newStartAt: '2026-06-27T09:00:00Z',
  newEndAt: '2026-06-27T11:00:00Z',
}

function mockReq(body: object): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

function mockParams(id = '1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbSelect.mockResolvedValue({ data: BOOKING })
  h.dbUpdate.mockResolvedValue({ error: null })
  h.fhValidate.mockResolvedValue({ is_bookable: true })
  h.fhRebook.mockResolvedValue({ uuid: 'fh-new-uuid' })
  h.fhCancel.mockResolvedValue(undefined)
})

describe('POST /api/admin/bookings/[id]/rebook', () => {
  it('uses rebookBooking (not createBooking) when booking has a FH UUID', async () => {
    const res = await POST(mockReq(BODY), mockParams())
    const json = await res.json()
    expect(json.data.rebooked).toBe(true)
    expect(json.data.newBookingUuid).toBe('fh-new-uuid')
    expect(h.fhRebook).toHaveBeenCalledWith(BODY.newAvailPk, expect.any(Object), 'old-fh-uuid')
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  // Regression test for the Brenda Blechle incident (Aug 2026): rebook created the new FH
  // booking correctly, but then explicitly cancelled the old UUID — which cascaded through
  // FareHarbor's `rebooking` link and cancelled the NEW booking instead, refunding the
  // customer's payment and leaving them with no valid booking. FH already retires the old
  // booking itself via the link, so this route must never call cancelBooking() after a
  // successful rebookBooking().
  it('never calls cancelBooking after a successful rebook (FH retires the old booking via the rebooking link)', async () => {
    const res = await POST(mockReq(BODY), mockParams())
    const json = await res.json()
    expect(json.data.rebooked).toBe(true)
    expect(h.fhCancel).not.toHaveBeenCalled()
  })

  it('falls back to createBooking when booking has no FH UUID', async () => {
    h.dbSelect.mockResolvedValue({ data: { ...BOOKING, booking_uuid: null } })
    const res = await POST(mockReq(BODY), mockParams())
    const json = await res.json()
    expect(json.data.rebooked).toBe(true)
    expect(h.fhCreate).toHaveBeenCalled()
    expect(h.fhRebook).not.toHaveBeenCalled()
    expect(h.fhCancel).not.toHaveBeenCalled()
  })

  it('returns 422 when validation fails', async () => {
    h.fhValidate.mockResolvedValue({ is_bookable: false, error: 'Slot full' })
    const res = await POST(mockReq(BODY), mockParams())
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toBe('Slot full')
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(mockReq({ newDate: '2026-06-27' }), mockParams())
    expect(res.status).toBe(400)
  })

  it('returns 404 when booking not found', async () => {
    h.dbSelect.mockResolvedValue({ data: null })
    const res = await POST(mockReq(BODY), mockParams())
    expect(res.status).toBe(404)
  })

  it('returns 409 when booking is already cancelled', async () => {
    h.dbSelect.mockResolvedValue({ data: { ...BOOKING, status: 'cancelled' } })
    const res = await POST(mockReq(BODY), mockParams())
    expect(res.status).toBe(409)
  })

  it('sends a Slack notification on successful rebook', async () => {
    await POST(mockReq(BODY), mockParams())
    expect(h.postSlackOps).toHaveBeenCalledOnce()
    const msg = h.postSlackOps.mock.calls[0][0] as string
    expect(msg).toContain('rescheduled')
    expect(msg).toContain('Enrico Test')
    expect(msg).toContain('enrico@example.com')
    expect(msg).toContain('fh-new-uuid')
    expect(msg).toContain('2026-06-27')
  })

  it('sends reschedule email to customer by default', async () => {
    await POST(mockReq(BODY), mockParams())
    expect(h.sendRescheduleEmail).toHaveBeenCalled()
  })

  it('suppresses customer email when sendEmail is false', async () => {
    await POST(mockReq({ ...BODY, sendEmail: false }), mockParams())
    expect(h.sendRescheduleEmail).not.toHaveBeenCalled()
  })
})

describe('bookings that exist in FareHarbor but have no uuid', () => {
  it('refuses rather than creating a SECOND live booking for the same guest', async () => {
    // Without the guard this fell through to createBooking() and then skipped
    // the (uuid-gated) cancel — two slots consumed for one guest, with the
    // original left live and our row silently repointed to the new one.
    h.dbSelect.mockResolvedValue({
      data: { ...BOOKING, booking_uuid: null, external_id: '371969124', booking_source: 'tripadvisor' },
      error: null,
    })

    const res = await POST(mockReq(BODY), mockParams())

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('would create a second booking')
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.fhRebook).not.toHaveBeenCalled()
    expect(h.dbUpdate).not.toHaveBeenCalled()
  })

  it('recognises the fh_ booking_id form too', async () => {
    h.dbSelect.mockResolvedValue({
      data: { ...BOOKING, booking_uuid: null, external_id: '', booking_id: 'fh_371969124' },
      error: null,
    })

    const res = await POST(mockReq(BODY), mockParams())

    expect(res.status).toBe(409)
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('rebooks normally once the uuid is known (the backfilled case)', async () => {
    h.dbSelect.mockResolvedValue({
      data: { ...BOOKING, booking_uuid: 'old-fh-uuid', external_id: '371969124' },
      error: null,
    })

    const res = await POST(mockReq(BODY), mockParams())

    expect(res.status).toBe(200)
    expect(h.fhRebook).toHaveBeenCalled()
  })

  it('still allows the createBooking fallback for an admin-only booking', async () => {
    // No uuid AND never in FareHarbor — the case that fallback was written for.
    h.dbSelect.mockResolvedValue({
      data: { ...BOOKING, booking_uuid: null, external_id: '', booking_id: 'pi_test_123' },
      error: null,
    })

    const res = await POST(mockReq(BODY), mockParams())

    expect(res.status).toBe(200)
    expect(h.fhCreate).toHaveBeenCalled()
  })
})
