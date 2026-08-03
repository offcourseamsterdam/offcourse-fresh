import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtrasLineItem } from './filter'

// Regression coverage: the supplier only handles food, never drinks. This
// caught a real bug where the email + send-eligibility check both used
// filterCateringItems (food + drinks) instead of filterFoodItems.

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  single: vi.fn(),
  update: vi.fn().mockResolvedValue({ error: null }),
  emailsSend: vi.fn().mockResolvedValue({}),
  postSlackText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: h.single }) }),
      update: () => ({ eq: h.update }),
    }),
  }),
}))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('@/lib/fareharbor/client', () => ({ getFareHarborClient: () => ({ updateBookingNote: vi.fn() }) }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.emailsSend }
  },
}))

import { sendCateringOrderEmailForBooking } from './send-catering-email'

const food: ExtrasLineItem = { name: 'Charcuterie board', amount_cents: 2000, category: 'food', quantity: 1 }
const drinks: ExtrasLineItem = { name: 'Unlimited Drinks', amount_cents: 8000, category: 'drinks', quantity: 1 }

const BOOKING = {
  id: 'b1',
  booking_uuid: null,
  customer_name: 'Test Guest',
  listing_title: 'Private Hidden Gems Cruise',
  tour_item_name: null,
  booking_date: '2026-07-10',
  start_time: '2026-07-10T14:30:00+02:00',
  guest_count: 4,
  category: 'private',
  catering_email_sent_at: null,
  guest_note: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('CATERING_EMAIL_RECIPIENT', 'caterer@example.com')
  h.update.mockResolvedValue({ error: null })
})

describe('sendCateringOrderEmailForBooking — supplier only handles food, never drinks', () => {
  it('skips a drinks-only booking — nothing to email the supplier about', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [drinks] }, error: null })

    const result = await sendCateringOrderEmailForBooking('b1')

    expect(result).toEqual({ ok: false, reason: 'No food items on this booking' })
    expect(h.emailsSend).not.toHaveBeenCalled()
    expect(h.postSlackText).not.toHaveBeenCalled()
  })

  it('sends for a food item, and the email never mentions drinks even when both are ordered', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [food, drinks] }, error: null })

    const result = await sendCateringOrderEmailForBooking('b1')

    expect(result.ok).toBe(true)
    expect(h.emailsSend).toHaveBeenCalledTimes(1)
    const emailText = h.emailsSend.mock.calls[0][0].text
    expect(emailText).toContain('Charcuterie board')
    expect(emailText).not.toContain('Unlimited Drinks')
    expect(emailText.toLowerCase()).not.toContain('drink')

    const slackMsg = h.postSlackText.mock.calls[0][0]
    expect(slackMsg).toContain('Charcuterie board')
    expect(slackMsg).not.toContain('Unlimited Drinks')
  })
})
