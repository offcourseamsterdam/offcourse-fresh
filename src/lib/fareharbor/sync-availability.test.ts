import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAvailabilitiesDateRange: vi.fn(),
  upsert: vi.fn().mockResolvedValue({ error: null }),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    getAvailabilitiesDateRange: mocks.getAvailabilitiesDateRange,
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

const mockFhItems = [
  {
    id: 'fh-item-1',
    fareharbor_pk: 101,
    name: 'Private Canal Tour',
    item_type: 'private',
    resources: [{ fareharbor_pk: 501, name: 'Salon boat Diana' }],
    booking_cutoff_hours: 2,
    max_slot_capacity: 12,
  },
  {
    id: 'fh-item-2',
    fareharbor_pk: 102,
    name: 'Shared Canal Tour',
    item_type: 'shared',
    resources: [{ fareharbor_pk: 502, name: 'Salon boat Curaçao' }],
    booking_cutoff_hours: 1,
    max_slot_capacity: 12,
  },
]

const mockListings = [
  {
    id: 'listing-1',
    slug: 'classic-private-tour',
    title: 'Classic Private Tour',
    category: 'private',
    fareharbor_item_pk: 101,
    allowed_resource_pks: [501],
    allowed_customer_type_pks: null,
    availability_filters: null,
    booking_cutoff_hours: null,
    max_guests: 12,
    starting_price: 250,
  },
]

const mockRawAvailabilities = [
  {
    pk: 9001,
    start_at: '2026-09-10T14:00:00+02:00',
    end_at: '2026-09-10T15:30:00+02:00',
    capacity: 12,
    customer_type_rates: [
      {
        pk: 8001,
        capacity: 12,
        customer_type: { pk: 701, singular: 'Whole Boat', plural: 'Whole Boat' },
        customer_prototype: { total: 25000, total_including_tax: 25000 },
      },
    ],
  },
]

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'fareharbor_items') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: mockFhItems, error: null }),
          }),
        }
      }
      if (table === 'cruise_listings') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: mockListings, error: null }),
          }),
        }
      }
      if (table === 'cruise_availability_snapshots') {
        return {
          upsert: mocks.upsert,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

import { syncAllCruisesAvailability } from './sync-availability'

describe('syncAllCruisesAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAvailabilitiesDateRange.mockResolvedValue(mockRawAvailabilities)
  })

  it('queries FareHarbor for the 2 items in 2 blocks of 7 days (4 calls total)', async () => {
    const result = await syncAllCruisesAvailability(14)

    expect(result.success).toBe(true)
    expect(result.syncedListingsCount).toBe(1)
    expect(result.updatedSlugs).toContain('classic-private-tour')

    // 2 items * 2 date range calls = 4 calls
    expect(mocks.getAvailabilitiesDateRange).toHaveBeenCalledTimes(4)
    expect(mocks.upsert).toHaveBeenCalledTimes(1)

    // Check upsert payload
    const upsertCall = mocks.upsert.mock.calls[0][0]
    expect(upsertCall).toHaveLength(1)
    const snapshot = upsertCall[0]
    expect(snapshot.listing_id).toBe('listing-1')
    expect(snapshot.fareharbor_item_pk).toBe(101)
    expect(snapshot.category).toBe('private')
    expect(snapshot.raw_availability_window_days).toBe(14)

    // Verify revalidatePath was called for all locales
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/en/cruises')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/en/cruises/classic-private-tour')
  })
})
