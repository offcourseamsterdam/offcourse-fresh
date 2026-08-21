import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { generateExtrasToken } from '@/lib/booking/extras-token'

/**
 * Regression test for the post-booking "add extras" upsell endpoint.
 *
 * Bug: the Slack "🍽️ New catering pre-order" ping fired for ANY extra added
 * via this route — including drinks-only pre-orders (e.g. "Unlimited Drinks"
 * on a shared cruise) — even though the actual supplier email correctly only
 * fires for food (see src/lib/catering/filter.ts). A drinks-only pre-order
 * would post a Slack message titled "catering pre-order", reading as if an
 * order had gone out when nothing had. Fixed by gating the Slack post on the
 * same food-only `hasCatering` flag the supplier email already uses.
 */

const h = vi.hoisted(() => ({
  bookingMaybeSingle: vi.fn(),
  extrasEq: vi.fn(),
  bookingUpdate: vi.fn().mockResolvedValue({ error: null }),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  resendSend: vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
  afterCallback: null as (() => Promise<void> | void) | null,
}))

vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => { h.afterCallback = cb },
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: h.bookingMaybeSingle }) }),
          update: (payload: unknown) => ({ eq: () => h.bookingUpdate(payload) }),
        }
      }
      if (table === 'extras') {
        return { select: () => ({ in: () => ({ eq: h.extrasEq }) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    getBooking: vi.fn(),
    updateBookingNote: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText, postSlackOps: h.postSlackOps }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.resendSend }
  },
}))

import { POST } from './route'

const BOOKING_ID = 'booking-1'
const TOKEN = generateExtrasToken(BOOKING_ID)

function baseBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    booking_uuid: null, // no FH booking_uuid → skips the adult-split + FH-note branches
    customer_name: 'Test Guest',
    listing_title: 'Sunset Shared Cruise',
    booking_date: '2099-01-01',
    start_time: '2099-01-01T10:00:00+02:00',
    end_time: '2099-01-01T11:30:00+02:00',
    guest_count: 4,
    category: 'shared',
    status: 'confirmed',
    extras_selected: [],
    extras_amount_cents: 0,
    extras_vat_amount_cents: 0,
    total_vat_amount_cents: 0,
    base_amount_cents: 10000,
    guest_note: null,
    ...overrides,
  }
}

const DRINKS_EXTRA = {
  id: 'drinks-1',
  name: 'Unlimited Drinks',
  category: 'drinks',
  price_type: 'per_person_per_hour_cents',
  price_value: 500,
  vat_rate: 21,
  is_required: false,
  quantity_mode: 'toggle',
  min_quantity: null,
  min_people: null,
  adults_only: true,
}

const FOOD_EXTRA = {
  id: 'food-1',
  name: 'Bitterballen',
  category: 'food',
  price_type: 'fixed_cents',
  price_value: 1000,
  vat_rate: 9,
  is_required: false,
  quantity_mode: 'counter',
  min_quantity: 1,
  min_people: null,
  adults_only: false,
}

function postReq(selections: { extra_id: string; quantity: number }[]) {
  return new NextRequest(`http://test.local/api/booking/extras/${BOOKING_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, selections }),
  })
}

const params = Promise.resolve({ id: BOOKING_ID })

beforeEach(() => {
  vi.clearAllMocks()
  h.afterCallback = null
  h.bookingUpdate.mockResolvedValue({ error: null })
})

describe('POST /api/booking/extras/[id] — catering Slack gate', () => {
  it('stays silent on Slack for a drinks-only pre-order (e.g. Unlimited Drinks on a shared cruise)', async () => {
    h.bookingMaybeSingle.mockResolvedValue({ data: baseBooking(), error: null })
    h.extrasEq.mockResolvedValue({ data: [DRINKS_EXTRA], error: null })

    const res = await POST(postReq([{ extra_id: 'drinks-1', quantity: 1 }]), { params })
    expect(res.status).toBe(200)

    await h.afterCallback?.()

    expect(h.postSlackText).not.toHaveBeenCalled()
    expect(h.resendSend).not.toHaveBeenCalled()
    // No food → catering_email_sent_at must NOT be stamped either.
    expect(h.bookingUpdate).toHaveBeenCalledWith(
      expect.not.objectContaining({ catering_email_sent_at: expect.anything() }),
    )
  })

  it('still posts to Slack and emails the supplier when food is included', async () => {
    h.bookingMaybeSingle.mockResolvedValue({ data: baseBooking(), error: null })
    h.extrasEq.mockResolvedValue({ data: [DRINKS_EXTRA, FOOD_EXTRA], error: null })

    const res = await POST(
      postReq([{ extra_id: 'drinks-1', quantity: 1 }, { extra_id: 'food-1', quantity: 2 }]),
      { params },
    )
    expect(res.status).toBe(200)

    await h.afterCallback?.()

    expect(h.postSlackText).toHaveBeenCalledTimes(1)
    expect(h.postSlackText.mock.calls[0][0]).toContain('New catering pre-order')
    expect(h.bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ catering_email_sent_at: expect.any(String) }),
    )
  })

  it('stays silent on Slack for a food-free order even when other non-catering extras are added', async () => {
    const insurance = {
      id: 'insurance-1',
      name: 'Cancellation Insurance',
      category: 'insurance',
      price_type: 'percentage',
      price_value: 5,
      vat_rate: 21,
      is_required: false,
      quantity_mode: 'toggle',
      min_quantity: null,
      min_people: null,
      adults_only: false,
    }
    h.bookingMaybeSingle.mockResolvedValue({ data: baseBooking(), error: null })
    h.extrasEq.mockResolvedValue({ data: [insurance], error: null })

    await POST(postReq([{ extra_id: 'insurance-1', quantity: 1 }]), { params })
    await h.afterCallback?.()

    expect(h.postSlackText).not.toHaveBeenCalled()
  })
})
