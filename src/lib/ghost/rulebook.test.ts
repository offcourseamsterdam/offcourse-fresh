import { describe, it, expect } from 'vitest'
import { moveIncentiveFor, PRIVATE_MOVE_INCENTIVE, SHARED_MOVE_INCENTIVE } from './rulebook'
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
