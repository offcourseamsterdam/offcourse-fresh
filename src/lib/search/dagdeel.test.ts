import { describe, it, expect } from 'vitest'
import { filterSlotsByDagdeel, type Dagdeel } from './dagdeel'

const makeSlot = (startTime: string) => ({
  pk: 1, startTime, startAt: '', endAt: '', headline: '',
  customerTypes: [], capacity: 1,
})

describe('filterSlotsByDagdeel', () => {
  it('returns all slots for "all"', () => {
    const slots = [makeSlot('09:00'), makeSlot('14:00'), makeSlot('19:00')]
    expect(filterSlotsByDagdeel(slots, 'all')).toHaveLength(3)
  })

  it('filters morning slots (06:00–11:59)', () => {
    const slots = [makeSlot('06:00'), makeSlot('11:30'), makeSlot('12:00')]
    expect(filterSlotsByDagdeel(slots, 'morning')).toHaveLength(2)
  })

  it('filters afternoon slots (12:00–16:59)', () => {
    const slots = [makeSlot('11:30'), makeSlot('12:00'), makeSlot('16:30'), makeSlot('17:00')]
    expect(filterSlotsByDagdeel(slots, 'afternoon')).toHaveLength(2)
  })

  it('filters evening slots (17:00–22:59)', () => {
    const slots = [makeSlot('16:30'), makeSlot('17:00'), makeSlot('21:00'), makeSlot('23:00')]
    expect(filterSlotsByDagdeel(slots, 'evening')).toHaveLength(2)
  })
})
