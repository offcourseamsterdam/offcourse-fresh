import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtrasLineItem } from './filter'

// Regression coverage: the supplier only handles food, never drinks. This
// caught a real bug where the email + send-eligibility check both used
// filterCateringItems (food + drinks) instead of filterFoodItems.

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  single: vi.fn(),
  update: vi.fn().mockResolvedValue({ error: null }),
  updateArgs: [] as unknown[],
  sendNewEmail: vi.fn().mockResolvedValue({ id: 'gmail-msg-1', threadId: 'thread-new-1' }),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  emitOpsEvent: vi.fn().mockResolvedValue(undefined),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: h.emitOpsEvent }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: h.single }) }),
      update: (patch: unknown) => ({
        eq: (...args: unknown[]) => {
          h.updateArgs.push(patch)
          return h.update(...args)
        },
      }),
    }),
  }),
}))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText, postSlackOps: h.postSlackOps }))
vi.mock('@/lib/fareharbor/client', () => ({ getFareHarborClient: () => ({ updateBookingNote: vi.fn() }) }))
vi.mock('@/lib/gmail/client', () => ({ sendNewEmail: h.sendNewEmail }))

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
  catering_thread_id: null as string | null,
  guest_note: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CATERING_EMAIL_RECIPIENT', 'caterer@example.com')
  h.update.mockResolvedValue({ error: null })
  h.updateArgs.length = 0
  h.sendNewEmail.mockResolvedValue({ id: 'gmail-msg-1', threadId: 'thread-new-1' })
})

describe('sendCateringOrderEmailForBooking — supplier only handles food, never drinks', () => {
  it('skips a drinks-only booking — nothing to email the supplier about', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [drinks] }, error: null })

    const result = await sendCateringOrderEmailForBooking('b1')

    expect(result).toEqual({ ok: false, reason: 'No food items on this booking' })
    expect(h.sendNewEmail).not.toHaveBeenCalled()
    expect(h.postSlackText).not.toHaveBeenCalled()
  })

  it('sends for a food item, and the email never mentions drinks even when both are ordered', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [food, drinks] }, error: null })

    const result = await sendCateringOrderEmailForBooking('b1')

    expect(result.ok).toBe(true)
    expect(h.sendNewEmail).toHaveBeenCalledTimes(1)
    const emailBody = h.sendNewEmail.mock.calls[0][0].body
    expect(emailBody).toContain('Charcuterie board')
    expect(emailBody).not.toContain('Unlimited Drinks')
    expect(emailBody.toLowerCase()).not.toContain('drink')

    const slackMsg = h.postSlackText.mock.calls[0][0]
    expect(slackMsg).toContain('Charcuterie board')
    expect(slackMsg).not.toContain('Unlimited Drinks')
  })
})

describe('sendCateringOrderEmailForBooking — Gmail thread tracking', () => {
  it('sends via Gmail (not Resend) and stores the returned threadId on catering_thread_id', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [food] }, error: null })
    h.sendNewEmail.mockResolvedValue({ id: 'gmail-msg-1', threadId: 'thread-abc' })

    const result = await sendCateringOrderEmailForBooking('b1')

    expect(result.ok).toBe(true)
    expect(h.sendNewEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'caterer@example.com', threadId: undefined }),
    )
    expect(h.updateArgs[0]).toMatchObject({ catering_thread_id: 'thread-abc' })
  })

  it('on a resend, reuses the existing catering_thread_id instead of starting a new thread', async () => {
    h.single.mockResolvedValue({
      data: {
        ...BOOKING,
        extras_selected: [food],
        catering_email_sent_at: '2026-07-01T10:00:00.000Z',
        catering_thread_id: 'thread-existing',
      },
      error: null,
    })
    // Gmail echoes back the same threadId when sending into an existing thread.
    h.sendNewEmail.mockResolvedValue({ id: 'gmail-msg-2', threadId: 'thread-existing' })

    const result = await sendCateringOrderEmailForBooking('b1')

    expect(result).toMatchObject({ ok: true, resent: true })
    expect(h.sendNewEmail).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-existing' }),
    )
    expect(h.updateArgs[0]).toMatchObject({ catering_thread_id: 'thread-existing' })
  })

  it('returns ok:false instead of throwing when the Gmail send itself fails — callers (esp. the daily cron loop) rely on never getting an exception', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [food] }, error: null })
    h.sendNewEmail.mockRejectedValue(new Error('GMAIL_USER not configured'))

    const result = await sendCateringOrderEmailForBooking('b1')

    expect(result).toEqual({ ok: false, reason: 'GMAIL_USER not configured' })
    expect(h.updateArgs).toHaveLength(0)
  })
})

describe('sendCateringOrderEmailForBooking — ops event for the booking timeline', () => {
  it('emits a catering_order_sent ops event on a successful send', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [food] }, error: null })

    await sendCateringOrderEmailForBooking('b1')

    expect(h.emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'catering_order_sent', bookingId: 'b1' }),
    )
  })

  it('does not emit an event when there is nothing to send', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [drinks] }, error: null })

    await sendCateringOrderEmailForBooking('b1')

    expect(h.emitOpsEvent).not.toHaveBeenCalled()
  })

  it('does not emit an event when the Gmail send fails', async () => {
    h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [food] }, error: null })
    h.sendNewEmail.mockRejectedValue(new Error('GMAIL_USER not configured'))

    await sendCateringOrderEmailForBooking('b1')

    expect(h.emitOpsEvent).not.toHaveBeenCalled()
  })
})
