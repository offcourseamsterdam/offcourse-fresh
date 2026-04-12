import { describe, it, expect, vi } from 'vitest'
import type { FHMinimalAvailability, FHCustomerTypeRate } from './types'
import type { CustomerTypeConfig } from './config'
import {
  getTimeFromISO,
  getValidTimeSlots,
  getAvailableDurations,
  getBoatStatus,
  getReasonCode,
  applyAllFilters,
  AvailabilityFiltersSchema,
} from './filters'
import { transformToSlot } from './availability'

// ── Mock sunset module to avoid real API calls ──────────────────────────────

vi.mock('./sunset', () => ({
  getSunsetTime: vi.fn(async () => '20:30'), // Mock sunset at 20:30
}))

// ── Test fixtures ───────────────────────────────────────────────────────────

function makeRate(pk: number, customerTypePk: number, capacity = 1): FHCustomerTypeRate {
  return {
    pk,
    customer_type: { pk: customerTypePk, singular: `Type ${customerTypePk}`, plural: `Types ${customerTypePk}` },
    capacity,
  }
}

function makeAvailability(
  pk: number,
  startAt: string,
  rates: FHCustomerTypeRate[],
  capacity = 10
): FHMinimalAvailability {
  return {
    pk,
    start_at: startAt,
    end_at: startAt, // Not used in filters
    capacity,
    customer_type_rates: rates,
  }
}

// Customer type configs matching real boat setup
const dianaShort: CustomerTypeConfig = { pk: 100, boat: 'diana', duration: 90, maxGuests: 8, priority: 1 }
const dianaLong: CustomerTypeConfig = { pk: 101, boat: 'diana', duration: 120, maxGuests: 8, priority: 1 }
const curacaoShort: CustomerTypeConfig = { pk: 200, boat: 'curacao', duration: 90, maxGuests: 12, priority: 2 }
const curacaoLong: CustomerTypeConfig = { pk: 201, boat: 'curacao', duration: 120, maxGuests: 12, priority: 2 }

const typeMap = new Map<number, CustomerTypeConfig>([
  [100, dianaShort],
  [101, dianaLong],
  [200, curacaoShort],
  [201, curacaoLong],
])

// Resource PK to boat mapping
const resourcePkToBoat = new Map<number, string>([
  [1, 'diana'],
  [2, 'curacao'],
])

// ── getTimeFromISO ──────────────────────────────────────────────────────────

describe('getTimeFromISO', () => {
  it('extracts time from ISO string in Amsterdam timezone', () => {
    // +02:00 is Amsterdam summer time (CEST)
    const time = getTimeFromISO('2026-07-15T14:00:00+02:00')
    expect(time).toBe('14:00')
  })

  it('handles different time formats', () => {
    const time = getTimeFromISO('2026-04-07T09:30:00+02:00')
    expect(time).toBe('09:30')
  })
})

// ── AvailabilityFiltersSchema ───────────────────────────────────────────────

describe('AvailabilityFiltersSchema', () => {
  it('parses valid filter config', () => {
    const result = AvailabilityFiltersSchema.safeParse({
      time_after: '17:00',
      time_before: '22:00',
      months: [6, 7, 8],
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty object', () => {
    const result = AvailabilityFiltersSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('allows passthrough of unknown fields', () => {
    const result = AvailabilityFiltersSchema.safeParse({
      time_after: '10:00',
      custom_field: 'whatever',
    })
    expect(result.success).toBe(true)
  })
})

// ── getValidTimeSlots ───────────────────────────────────────────────────────

describe('getValidTimeSlots', () => {
  const availabilities = [
    makeAvailability(1, '2026-04-07T10:00:00+02:00', [
      makeRate(10, 100, 1), // Diana short, available
      makeRate(11, 200, 1), // Curacao short, available
    ]),
    makeAvailability(2, '2026-04-07T14:00:00+02:00', [
      makeRate(12, 100, 0), // Diana short, sold out
      makeRate(13, 200, 1), // Curacao short, available
    ]),
    makeAvailability(3, '2026-04-07T18:00:00+02:00', [
      makeRate(14, 100, 0), // Diana short, sold out
      makeRate(15, 200, 0), // Curacao short, sold out
    ]),
  ]

  it('returns slots with at least one rate with capacity >= 1 that fits guests', () => {
    const valid = getValidTimeSlots(availabilities, 4, typeMap)
    expect(valid).toHaveLength(2)
    expect(valid[0].pk).toBe(1)
    expect(valid[1].pk).toBe(2)
  })

  it('filters out slots where all rates have zero capacity', () => {
    const valid = getValidTimeSlots(availabilities, 4, typeMap)
    expect(valid.find(a => a.pk === 3)).toBeUndefined()
  })

  it('filters by guest count vs maxGuests', () => {
    // 10 guests exceeds Diana (8 max), only Curacao (12 max) qualifies
    const valid = getValidTimeSlots(availabilities, 10, typeMap)
    expect(valid).toHaveLength(2) // Slots 1 and 2 (Curacao rates available)
  })

  it('returns empty when guest count exceeds all boats', () => {
    const valid = getValidTimeSlots(availabilities, 15, typeMap)
    expect(valid).toHaveLength(0)
  })
})

// ── getAvailableDurations ───────────────────────────────────────────────────

describe('getAvailableDurations', () => {
  const availability = makeAvailability(1, '2026-04-07T10:00:00+02:00', [
    makeRate(10, 100, 1), // Diana 90min, available
    makeRate(11, 101, 1), // Diana 120min, available
    makeRate(12, 200, 1), // Curacao 90min, available
    makeRate(13, 201, 0), // Curacao 120min, sold out
  ])

  it('returns durations for specified boat', () => {
    const durations = getAvailableDurations(availability, 'diana', 4, typeMap)
    expect(durations).toHaveLength(2)
    expect(durations[0].customer_type.pk).toBe(100) // 90min first (sorted by duration)
    expect(durations[1].customer_type.pk).toBe(101) // 120min second
  })

  it('excludes sold out durations', () => {
    const durations = getAvailableDurations(availability, 'curacao', 4, typeMap)
    expect(durations).toHaveLength(1)
    expect(durations[0].customer_type.pk).toBe(200) // Only 90min available
  })

  it('filters by guest count', () => {
    // 10 guests exceeds Diana's 8 max
    const durations = getAvailableDurations(availability, 'diana', 10, typeMap)
    expect(durations).toHaveLength(0)
  })

  it('sorts by duration ascending', () => {
    const durations = getAvailableDurations(availability, 'diana', 2, typeMap)
    const configs = durations.map(d => typeMap.get(d.customer_type.pk)!)
    expect(configs[0].duration).toBeLessThanOrEqual(configs[1].duration)
  })
})

// ── getBoatStatus ───────────────────────────────────────────────────────────

describe('getBoatStatus', () => {
  const availability = makeAvailability(1, '2026-04-07T10:00:00+02:00', [
    makeRate(10, 100, 1), // Diana 90min
    makeRate(11, 101, 0), // Diana 120min, sold out
    makeRate(12, 200, 1), // Curacao 90min
  ])

  it('returns available when boat has capacity', () => {
    const result = getBoatStatus(availability, 'diana', 4, typeMap)
    expect(result.status).toBe('available')
  })

  it('returns too_many_guests when group exceeds boat max', () => {
    const result = getBoatStatus(availability, 'diana', 10, typeMap)
    expect(result.status).toBe('too_many_guests')
    expect(result.reason).toBe('TOO_LARGE')
  })

  it('returns sold_out when all durations are at zero capacity', () => {
    const allSoldOut = makeAvailability(2, '2026-04-07T10:00:00+02:00', [
      makeRate(10, 100, 0),
      makeRate(11, 101, 0),
    ])
    const result = getBoatStatus(allSoldOut, 'diana', 4, typeMap)
    expect(result.status).toBe('sold_out')
    expect(result.reason).toBe('ALL_FULL')
  })

  it('returns unavailable for unknown boat', () => {
    const result = getBoatStatus(availability, 'unknown' as 'diana', 4, typeMap)
    expect(result.status).toBe('unavailable')
  })
})

// ── getReasonCode ───────────────────────────────────────────────────────────

describe('getReasonCode', () => {
  it('returns NO_AVAILABILITIES when array is empty', () => {
    expect(getReasonCode([], 4, typeMap)).toBe('NO_AVAILABILITIES')
  })

  it('returns TOO_LARGE when guest count exceeds all configs', () => {
    const avails = [makeAvailability(1, '2026-04-07T10:00:00+02:00', [makeRate(10, 100, 1)])]
    // Max in typeMap is 12 (curacao), so 15 should be TOO_LARGE
    expect(getReasonCode(avails, 15, typeMap)).toBe('TOO_LARGE')
  })

  it('returns ALL_FULL when within capacity but no availability', () => {
    const avails = [makeAvailability(1, '2026-04-07T10:00:00+02:00', [makeRate(10, 100, 0)])]
    expect(getReasonCode(avails, 4, typeMap)).toBe('ALL_FULL')
  })
})

// ── applyAllFilters (integration) ───────────────────────────────────────────

describe('applyAllFilters', () => {
  const availabilities = [
    makeAvailability(1, '2026-07-15T10:00:00+02:00', [
      makeRate(10, 100, 1), // Diana 90min
      makeRate(11, 200, 1), // Curacao 90min
    ]),
    makeAvailability(2, '2026-07-15T14:00:00+02:00', [
      makeRate(12, 101, 1), // Diana 120min
      makeRate(13, 201, 1), // Curacao 120min
    ]),
    makeAvailability(3, '2026-07-15T18:00:00+02:00', [
      makeRate(14, 100, 1), // Diana 90min
      makeRate(15, 200, 1), // Curacao 90min
    ]),
  ]

  it('returns all when no filters are set', async () => {
    const config = {
      allowed_resource_pks: null,
      allowed_customer_type_pks: null,
      availability_filters: null,
    }
    const result = await applyAllFilters(availabilities, config, 4, new Date('2026-07-15'), typeMap)
    expect(result).toHaveLength(3)
  })

  it('applies customer type filter', async () => {
    const config = {
      allowed_resource_pks: null,
      allowed_customer_type_pks: [100, 101], // Diana only
      availability_filters: null,
    }
    const result = await applyAllFilters(availabilities, config, 4, new Date('2026-07-15'), typeMap)
    // All slots have Diana rates, so all 3 remain but with only Diana rates
    expect(result).toHaveLength(3)
    result.forEach(a => {
      a.customer_type_rates.forEach(r => {
        expect([100, 101]).toContain(r.customer_type.pk)
      })
    })
  })

  it('applies resource filter', async () => {
    const config = {
      allowed_resource_pks: [1], // Diana resource PK
      allowed_customer_type_pks: null,
      availability_filters: null,
    }
    const result = await applyAllFilters(availabilities, config, 4, new Date('2026-07-15'), typeMap, resourcePkToBoat)
    // Only Diana rates should remain
    result.forEach(a => {
      a.customer_type_rates.forEach(r => {
        const ct = typeMap.get(r.customer_type.pk)!
        expect(ct.boat).toBe('diana')
      })
    })
  })

  it('applies time_after filter', async () => {
    const config = {
      allowed_resource_pks: null,
      allowed_customer_type_pks: null,
      availability_filters: { time_after: '12:00' },
    }
    const result = await applyAllFilters(availabilities, config, 4, new Date('2026-07-15'), typeMap)
    // Only 14:00 and 18:00 slots should remain
    expect(result).toHaveLength(2)
    expect(result[0].pk).toBe(2)
    expect(result[1].pk).toBe(3)
  })

  it('applies month filter', async () => {
    const config = {
      allowed_resource_pks: null,
      allowed_customer_type_pks: null,
      availability_filters: { months: [6, 8] }, // June + August only, NOT July
    }
    const result = await applyAllFilters(availabilities, config, 4, new Date('2026-07-15'), typeMap)
    // July is not in allowed months → empty
    expect(result).toHaveLength(0)
  })

  it('applies day_of_week filter', async () => {
    const config = {
      allowed_resource_pks: null,
      allowed_customer_type_pks: null,
      availability_filters: { days_of_week: [0, 6] }, // Weekend only (Sun + Sat)
    }
    // 2026-07-15 is a Wednesday (day 3)
    const result = await applyAllFilters(availabilities, config, 4, new Date('2026-07-15'), typeMap)
    expect(result).toHaveLength(0)
  })

  it('applies max_guests_override — blocks when exceeded', async () => {
    const config = {
      allowed_resource_pks: null,
      allowed_customer_type_pks: null,
      availability_filters: { max_guests_override: 2 }, // Romantic cruise, max 2
    }
    const result = await applyAllFilters(availabilities, config, 4, new Date('2026-07-15'), typeMap)
    // 4 guests > 2 max → empty
    expect(result).toHaveLength(0)
  })

  it('applies max_guests_override — allows when within limit', async () => {
    const config = {
      allowed_resource_pks: null,
      allowed_customer_type_pks: null,
      availability_filters: { max_guests_override: 2 },
    }
    const result = await applyAllFilters(availabilities, config, 2, new Date('2026-07-15'), typeMap)
    // 2 guests <= 2 max → OK
    expect(result).toHaveLength(3)
  })

  it('applies all 3 layers sequentially', async () => {
    const config = {
      allowed_resource_pks: [1], // Diana only
      allowed_customer_type_pks: [100], // Diana 90min only
      availability_filters: { time_after: '12:00' }, // Afternoon only
    }
    const result = await applyAllFilters(availabilities, config, 4, new Date('2026-07-15'), typeMap, resourcePkToBoat)
    // Slot 1 (10:00) filtered by time_after
    // Slot 2 (14:00) has Diana 120min (pk 101) but not 90min (pk 100) → filtered by customer type
    // Slot 3 (18:00) has Diana 90min → passes
    expect(result).toHaveLength(1)
    expect(result[0].pk).toBe(3)
  })
})

// ── transformToSlot capacity ───────────────────────────────────────────────

describe('transformToSlot — capacity calculation', () => {
  it('slot with mixed capacity rates uses max (not min)', () => {
    // Simulates 12:00 slot: 1.5h available (cap=1), 3h sold out (cap=0)
    const avail = makeAvailability(10, '2026-07-15T12:00:00+02:00', [
      makeRate(901, 100, 1), // Diana 90min — available
      makeRate(902, 101, 0), // Diana 120min — sold out
      makeRate(903, 200, 1), // Curaçao 90min — available
      makeRate(904, 201, 0), // Curaçao 120min — sold out
    ])
    const slot = transformToSlot(avail, typeMap)
    // Should be available (cap >= 1) because some durations are bookable
    expect(slot.capacity).toBeGreaterThanOrEqual(1)
  })

  it('slot with all rates at capacity 0 shows as sold out', () => {
    const avail = makeAvailability(11, '2026-07-15T15:00:00+02:00', [
      makeRate(911, 100, 0),
      makeRate(912, 101, 0),
      makeRate(913, 200, 0),
      makeRate(914, 201, 0),
    ])
    const slot = transformToSlot(avail, typeMap)
    expect(slot.capacity).toBe(0)
  })

  it('slot with no rates shows capacity 0', () => {
    const avail = makeAvailability(12, '2026-07-15T16:00:00+02:00', [])
    const slot = transformToSlot(avail, typeMap)
    expect(slot.capacity).toBe(0)
  })
})
