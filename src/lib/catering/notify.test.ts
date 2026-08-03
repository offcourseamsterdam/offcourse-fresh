import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyCateringOrder } from './notify'
import type { ExtrasLineItem } from './filter'

// Spy on the Slack sender — notifyCateringOrder posts a message iff there's food.
const postSlackText = vi.fn()
vi.mock('@/lib/slack/send-notification', () => ({
  postSlackText: (msg: string) => postSlackText(msg),
}))

const food: ExtrasLineItem = { name: 'Charcuterie board', amount_cents: 2000, category: 'food', quantity: 1 }
const drinks: ExtrasLineItem = { name: 'Unlimited Drinks', amount_cents: 8000, category: 'drinks', quantity: 1 }

const base = {
  cruiseName: 'Private Hidden Gems Cruise',
  dateStr: '2026-07-03',
  // Far-future so it never trips the "<24h urgent" branch — irrelevant to this rule.
  startTimeStr: '2026-07-03T14:30:00+02:00',
  guestCount: 4,
}

beforeEach(() => postSlackText.mockReset())

describe('notifyCateringOrder — only FOOD is a catering order', () => {
  it('does NOT notify for a drinks-only booking', async () => {
    await notifyCateringOrder({ ...base, extrasSelected: [drinks] })
    expect(postSlackText).not.toHaveBeenCalled()
  })

  it('notifies when there is a food item', async () => {
    await notifyCateringOrder({ ...base, extrasSelected: [food] })
    expect(postSlackText).toHaveBeenCalledTimes(1)
    expect(postSlackText.mock.calls[0][0]).toContain('Charcuterie board')
  })

  it('notifies for a food + drinks mix, but lists only the food', async () => {
    await notifyCateringOrder({ ...base, extrasSelected: [food, drinks] })
    expect(postSlackText).toHaveBeenCalledTimes(1)
    const msg = postSlackText.mock.calls[0][0]
    expect(msg).toContain('Charcuterie board')
    expect(msg).not.toContain('Unlimited Drinks')
  })

  it('does NOT notify for no extras', async () => {
    await notifyCateringOrder({ ...base, extrasSelected: [] })
    expect(postSlackText).not.toHaveBeenCalled()
  })
})
