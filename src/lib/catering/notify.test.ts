import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyCateringOrder } from './notify'
import type { ExtrasLineItem } from './filter'

// Spy on the Slack senders — notifyCateringOrder posts a message iff there's food,
// and an EXTRA DM to Beer iff the listing has an external-caterer override.
const postSlackText = vi.fn()
const postSlackOps = vi.fn()
vi.mock('@/lib/slack/send-notification', () => ({
  postSlackText: (msg: string) => postSlackText(msg),
  postSlackOps: (msg: string) => postSlackOps(msg),
}))

// Spy on the recipient lookup — real implementation hits Supabase, which unit
// tests must mock rather than call (see CLAUDE.md testing rules).
const resolveCateringEmailRecipient = vi.fn()
vi.mock('./recipient', () => ({
  resolveCateringEmailRecipient: (listingId: string | null) => resolveCateringEmailRecipient(listingId),
  isExternalCateringRecipient: (recipient: string) => recipient !== 'info@offcourseamsterdam.com',
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

beforeEach(() => {
  postSlackText.mockReset()
  postSlackOps.mockReset()
  resolveCateringEmailRecipient.mockReset()
  resolveCateringEmailRecipient.mockResolvedValue('info@offcourseamsterdam.com')
})

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

describe('notifyCateringOrder — external-caterer DM to Beer', () => {
  it('does NOT DM when no listingId is provided', async () => {
    await notifyCateringOrder({ ...base, extrasSelected: [food] })
    expect(resolveCateringEmailRecipient).not.toHaveBeenCalled()
    expect(postSlackOps).not.toHaveBeenCalled()
  })

  it('does NOT DM when the listing uses the site-wide default recipient', async () => {
    resolveCateringEmailRecipient.mockResolvedValue('info@offcourseamsterdam.com')
    await notifyCateringOrder({ ...base, extrasSelected: [food], listingId: 'listing-1' })
    expect(resolveCateringEmailRecipient).toHaveBeenCalledWith('listing-1')
    expect(postSlackOps).not.toHaveBeenCalled()
    // The normal #bookings alert still fires regardless
    expect(postSlackText).toHaveBeenCalledTimes(1)
  })

  it('DMs Beer in addition to the normal alert when the listing has an external caterer', async () => {
    resolveCateringEmailRecipient.mockResolvedValue('info@ashs-plek.nl')
    await notifyCateringOrder({ ...base, extrasSelected: [food], listingId: 'jamaican-buffet-listing' })
    expect(postSlackText).toHaveBeenCalledTimes(1) // unchanged — still goes to #bookings
    expect(postSlackOps).toHaveBeenCalledTimes(1)
    const dm = postSlackOps.mock.calls[0][0]
    expect(dm).toContain('info@ashs-plek.nl')
    expect(dm).toContain('Charcuterie board')
  })

  it('does NOT DM for a drinks-only booking even with an external-caterer listing (no food = no catering order at all)', async () => {
    resolveCateringEmailRecipient.mockResolvedValue('info@ashs-plek.nl')
    await notifyCateringOrder({ ...base, extrasSelected: [drinks], listingId: 'jamaican-buffet-listing' })
    expect(resolveCateringEmailRecipient).not.toHaveBeenCalled()
    expect(postSlackOps).not.toHaveBeenCalled()
  })
})
