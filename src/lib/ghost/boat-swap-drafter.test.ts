import { describe, it, expect } from 'vitest'
import { findSwapSlot } from './boat-swap-drafter'

describe('findSwapSlot — same time, different boat', () => {
  const ct = (over: Record<string, unknown> = {}) => ({
    pk: 555,
    boatId: 'curacao' as const,
    durationMinutes: 90,
    minimumParty: 1,
    maximumParty: 12,
    priceCents: 3500,
    name: 'Adult (13+)',
    totalCapacity: 12,
    customerTypePk: 1,
    ...over,
  })
  const slot = (pk: number, startAt: string, cts = [ct()]) =>
    ({ pk, startAt, startTime: 'x', endAt: startAt, headline: '', capacity: 12, customerTypes: cts }) as never

  const input = {
    startAt: '2026-08-28T08:15:00Z',
    durationMinutes: 90,
    toBoatKey: 'curacao' as const,
    category: 'private',
    guests: 4,
  }

  it('finds a slot at the EXACT current start time on the target boat', () => {
    const found = findSwapSlot([slot(1, '2026-08-28T08:15:00Z')], input)
    expect(found).toBeTruthy()
    expect(found!.availPk).toBe(1)
    expect(found!.customerTypeRatePk).toBe(555)
  })

  it('rejects any slot at a different time — a boat swap never changes when the guest sails', () => {
    expect(findSwapSlot([slot(1, '2026-08-28T08:30:00Z')], input)).toBeNull()
    expect(findSwapSlot([slot(1, '2026-08-28T08:00:00Z')], input)).toBeNull()
  })

  it('filters on boat and duration — the ask promises "same time, same cruise, different boat"', () => {
    expect(findSwapSlot([slot(1, '2026-08-28T08:15:00Z', [ct({ boatId: 'diana' })])], input)).toBeNull()
    expect(findSwapSlot([slot(1, '2026-08-28T08:15:00Z', [ct({ durationMinutes: 120 })])], input)).toBeNull()
  })

  it('shared: party must fit the customer type; private: min/max 1/1 types are NOT party-filtered (you book the boat, not seats)', () => {
    const tooSmall = [slot(1, '2026-08-28T08:15:00Z', [ct({ maximumParty: 2 })])]
    // private (input.category === 'private') ignores the party filter entirely
    expect(findSwapSlot(tooSmall, input)).toBeTruthy()
    // shared enforces it
    expect(findSwapSlot(tooSmall, { ...input, category: 'shared' })).toBeNull()
  })

  it('picks the cheapest matching customer type when more than one fits', () => {
    const found = findSwapSlot(
      [slot(1, '2026-08-28T08:15:00Z', [ct({ pk: 1, priceCents: 5000 }), ct({ pk: 2, priceCents: 3000 })])],
      input,
    )
    expect(found!.customerTypeRatePk).toBe(2)
  })
})
