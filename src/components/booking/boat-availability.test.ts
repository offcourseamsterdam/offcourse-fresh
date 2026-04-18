import { describe, it, expect } from 'vitest'
import type { AvailabilitySlot, AvailabilityCustomerType } from '@/types'
import { findNearestSlotsForBoat, isBoatBookableInSlot } from './boat-availability'

function makeCustomerType(
  overrides: Partial<AvailabilityCustomerType> & { boatId: 'diana' | 'curacao'; totalCapacity: number }
): AvailabilityCustomerType {
  return {
    pk: Math.floor(Math.random() * 1_000_000),
    customerTypePk: Math.floor(Math.random() * 1_000_000),
    minimumParty: 1,
    maximumParty: 12,
    priceCents: 16500,
    durationMinutes: 90,
    ...overrides,
  }
}

function makeSlot(
  pk: number,
  startTime: string,
  customerTypes: AvailabilityCustomerType[],
  date = '2026-05-01',
): AvailabilitySlot {
  return {
    pk,
    startTime,
    startAt: `${date}T${startTime}:00+02:00`,
    endAt: `${date}T${startTime}:00+02:00`,
    headline: '',
    customerTypes,
    capacity: Math.max(...customerTypes.map(c => c.totalCapacity), 0),
  }
}

describe('isBoatBookableInSlot', () => {
  it('returns true when at least one customerType for the boat has capacity >= 1', () => {
    const slot = makeSlot(1, '14:00', [
      makeCustomerType({ boatId: 'diana', totalCapacity: 0 }),
      makeCustomerType({ boatId: 'diana', totalCapacity: 1 }),
    ])
    expect(isBoatBookableInSlot(slot, 'diana')).toBe(true)
  })

  it('returns false when no customerType for the boat has capacity', () => {
    const slot = makeSlot(1, '14:00', [
      makeCustomerType({ boatId: 'diana', totalCapacity: 0 }),
      makeCustomerType({ boatId: 'curacao', totalCapacity: 1 }),
    ])
    expect(isBoatBookableInSlot(slot, 'diana')).toBe(false)
  })

  it('returns false when boat is absent from the slot entirely', () => {
    const slot = makeSlot(1, '14:00', [
      makeCustomerType({ boatId: 'curacao', totalCapacity: 1 }),
    ])
    expect(isBoatBookableInSlot(slot, 'diana')).toBe(false)
  })
})

describe('findNearestSlotsForBoat', () => {
  it('returns the latest earlier slot and the first later slot where the boat is bookable', () => {
    const s10 = makeSlot(10, '10:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const s12 = makeSlot(12, '12:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const selected = makeSlot(14, '14:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const s16 = makeSlot(16, '16:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const s18 = makeSlot(18, '18:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])

    const result = findNearestSlotsForBoat([s10, s12, selected, s16, s18], selected, 'diana')
    expect(result.earlier?.pk).toBe(12)
    expect(result.later?.pk).toBe(16)
  })

  it('skips slots where the boat has zero capacity', () => {
    const s10Sold = makeSlot(10, '10:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const s12Ok = makeSlot(12, '12:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const selected = makeSlot(14, '14:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const s16Sold = makeSlot(16, '16:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const s18Ok = makeSlot(18, '18:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 2 })])

    const result = findNearestSlotsForBoat([s10Sold, s12Ok, selected, s16Sold, s18Ok], selected, 'diana')
    expect(result.earlier?.pk).toBe(12)
    expect(result.later?.pk).toBe(18)
  })

  it('returns null for later when no slot after the selected time has the boat available', () => {
    const s12 = makeSlot(12, '12:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const selected = makeSlot(14, '14:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])

    const result = findNearestSlotsForBoat([s12, selected], selected, 'diana')
    expect(result.earlier?.pk).toBe(12)
    expect(result.later).toBeNull()
  })

  it('returns null for earlier when no slot before the selected time has the boat available', () => {
    const selected = makeSlot(14, '14:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const s16 = makeSlot(16, '16:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])

    const result = findNearestSlotsForBoat([selected, s16], selected, 'diana')
    expect(result.earlier).toBeNull()
    expect(result.later?.pk).toBe(16)
  })

  it('returns both null when no other slot has the boat available', () => {
    const s10Sold = makeSlot(10, '10:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const selected = makeSlot(14, '14:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const s18Sold = makeSlot(18, '18:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const s20Curacao = makeSlot(20, '20:00', [makeCustomerType({ boatId: 'curacao', totalCapacity: 1 })])

    const result = findNearestSlotsForBoat([s10Sold, selected, s18Sold, s20Curacao], selected, 'diana')
    expect(result.earlier).toBeNull()
    expect(result.later).toBeNull()
  })

  it('excludes the selected slot itself from the search', () => {
    const selected = makeSlot(14, '14:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const s16 = makeSlot(16, '16:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])

    const result = findNearestSlotsForBoat([selected, s16], selected, 'diana')
    expect(result.earlier).toBeNull()
    expect(result.later?.pk).toBe(16)
  })

  it('handles unsorted input by sorting by startAt', () => {
    const s10 = makeSlot(10, '10:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const s12 = makeSlot(12, '12:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const selected = makeSlot(14, '14:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 0 })])
    const s16 = makeSlot(16, '16:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])

    const result = findNearestSlotsForBoat([s16, s10, selected, s12], selected, 'diana')
    expect(result.earlier?.pk).toBe(12)
    expect(result.later?.pk).toBe(16)
  })

  it('searches per boat independently', () => {
    const s12Diana = makeSlot(12, '12:00', [makeCustomerType({ boatId: 'diana', totalCapacity: 1 })])
    const selected = makeSlot(14, '14:00', [
      makeCustomerType({ boatId: 'diana', totalCapacity: 0 }),
      makeCustomerType({ boatId: 'curacao', totalCapacity: 1 }),
    ])
    const s16Curacao = makeSlot(16, '16:00', [makeCustomerType({ boatId: 'curacao', totalCapacity: 1 })])

    const diana = findNearestSlotsForBoat([s12Diana, selected, s16Curacao], selected, 'diana')
    expect(diana.earlier?.pk).toBe(12)
    expect(diana.later).toBeNull()

    const curacao = findNearestSlotsForBoat([s12Diana, selected, s16Curacao], selected, 'curacao')
    expect(curacao.earlier).toBeNull()
    expect(curacao.later?.pk).toBe(16)
  })
})
