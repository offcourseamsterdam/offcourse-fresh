import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  requireAdmin: vi.fn().mockResolvedValue(null),
  sendCateringOrderEmailForBooking: vi.fn().mockResolvedValue({ ok: true, resent: false, recipient: 'cruise@pureboats.com' }),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  updateBookingNote: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: h.dbSelect }) }),
      update: () => ({ eq: h.dbUpdate }),
    }),
  }),
}))

vi.mock('@/lib/catering/send-catering-email', () => ({
  sendCateringOrderEmailForBooking: h.sendCateringOrderEmailForBooking,
}))

vi.mock('@/lib/catering/notify', () => ({
  notifyCateringOrder: h.notifyCateringOrder,
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    updateBookingNote: h.updateBookingNote,
  }),
}))

import { PATCH } from './route'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/admin/bookings/b-123', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const PARAMS = Promise.resolve({ id: 'b-123' })

describe('PATCH /api/admin/bookings/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.dbUpdate.mockResolvedValue({ error: null })
  })

  it('triggers sendCateringOrderEmailForBooking when food is added within 7-day auto-send window', async () => {
    // Tomorrow's date relative to now
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const bookingDateStr = tomorrow.toISOString().split('T')[0]

    h.dbSelect.mockResolvedValue({
      data: {
        id: 'b-123',
        booking_uuid: 'fh-123',
        guest_note: null,
        booking_date: bookingDateStr,
        start_time: `${bookingDateStr}T14:00:00Z`,
        guest_count: 8,
        listing_id: null,
        listing_title: 'Private Cruise',
        tour_item_name: 'Private Cruise',
        extras_selected: [],
        catering_email_sent_at: null,
      },
    })

    const foodExtras = [
      {
        name: 'Charcuterie Platter',
        category: 'food',
        quantity: 4,
        amount_cents: 4320,
        is_per_person_pick: true,
      },
    ]

    const res = await PATCH(makeRequest({ extras_selected: foodExtras }), { params: PARAMS })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(h.dbUpdate).toHaveBeenCalled()
    expect(h.sendCateringOrderEmailForBooking).toHaveBeenCalledWith('b-123')
  })

  it('does NOT trigger sendCateringOrderEmailForBooking when cruise is > 7 days away', async () => {
    // 20 days in the future
    const future = new Date()
    future.setDate(future.getDate() + 20)
    const bookingDateStr = future.toISOString().split('T')[0]

    h.dbSelect.mockResolvedValue({
      data: {
        id: 'b-123',
        booking_uuid: 'fh-123',
        guest_note: null,
        booking_date: bookingDateStr,
        start_time: `${bookingDateStr}T14:00:00Z`,
        guest_count: 8,
        listing_id: null,
        listing_title: 'Private Cruise',
        tour_item_name: 'Private Cruise',
        extras_selected: [],
        catering_email_sent_at: null,
      },
    })

    const foodExtras = [
      {
        name: 'Charcuterie Platter',
        category: 'food',
        quantity: 4,
        amount_cents: 4320,
        is_per_person_pick: true,
      },
    ]

    const res = await PATCH(makeRequest({ extras_selected: foodExtras }), { params: PARAMS })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(h.sendCateringOrderEmailForBooking).not.toHaveBeenCalled()
    // Notifies Slack for future review
    expect(h.notifyCateringOrder).toHaveBeenCalled()
    // Syncs note to FareHarbor
    expect(h.updateBookingNote).toHaveBeenCalled()
  })
})
