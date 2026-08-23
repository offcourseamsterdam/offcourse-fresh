import { describe, it, expect } from 'vitest'
import { moveIncentiveFor, PRIVATE_MOVE_INCENTIVE, SHARED_MOVE_INCENTIVE, hasEnoughNotice, MIN_RESCHEDULE_NOTICE_HOURS } from './rulebook'
import type { ExtrasLineItem } from '@/lib/catering/filter'

describe('moveIncentiveFor — the reschedule incentive rule (Beer, 2026-08-23)', () => {
  const unlimitedDrinks: ExtrasLineItem = { name: 'Unlimited Drinks Package', amount_cents: 4320, category: 'drinks', quantity: 4 }
  const byod: ExtrasLineItem = { name: 'Bring Your Own Drinks', amount_cents: 2000, category: 'drinks', quantity: 4 }
  const food: ExtrasLineItem = { name: 'Cheese platter', amount_cents: 1500, category: 'food', quantity: 1 }

  it('private cruises always get the sparkling wine bottle, regardless of extras', () => {
    expect(moveIncentiveFor('private', null)).toBe(PRIVATE_MOVE_INCENTIVE)
    expect(moveIncentiveFor('private', [unlimitedDrinks])).toBe(PRIVATE_MOVE_INCENTIVE)
  })

  it('shared cruises without Unlimited Drinks get free first drinks', () => {
    expect(moveIncentiveFor('shared', null)).toBe(SHARED_MOVE_INCENTIVE)
    expect(moveIncentiveFor('shared', [])).toBe(SHARED_MOVE_INCENTIVE)
    expect(moveIncentiveFor('shared', [byod])).toBe(SHARED_MOVE_INCENTIVE)
    expect(moveIncentiveFor('shared', [food])).toBe(SHARED_MOVE_INCENTIVE)
  })

  it('shared cruises WITH Unlimited Drinks get no incentive — offering drinks again would be redundant, not a fallback to something else', () => {
    expect(moveIncentiveFor('shared', [unlimitedDrinks])).toBeNull()
    expect(moveIncentiveFor('shared', [unlimitedDrinks, food])).toBeNull()
  })
})

describe('hasEnoughNotice — the minimum-runway cutoff (Beer, 2026-08-23: "18 hours, the earlier the better")', () => {
  function hoursFromNow(hours: number): string {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
  }

  it('rejects a departure less than the threshold away', () => {
    expect(hasEnoughNotice(hoursFromNow(MIN_RESCHEDULE_NOTICE_HOURS - 1))).toBe(false)
    expect(hasEnoughNotice(hoursFromNow(1))).toBe(false)
  })

  it('accepts a departure at or beyond the threshold', () => {
    expect(hasEnoughNotice(hoursFromNow(MIN_RESCHEDULE_NOTICE_HOURS))).toBe(true)
    expect(hasEnoughNotice(hoursFromNow(24 * 30))).toBe(true)
  })

  it('rejects a departure that has already passed', () => {
    expect(hasEnoughNotice(hoursFromNow(-2))).toBe(false)
  })

  it('rejects a missing departure time rather than crashing', () => {
    expect(hasEnoughNotice(null)).toBe(false)
    expect(hasEnoughNotice(undefined)).toBe(false)
  })
})
