import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicCruiseList } from './get-public-cruise-list'

const h = vi.hoisted(() => ({
  order: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: h.order,
          }),
        }),
      }),
    }),
  }),
}))

const ROWS = [
  {
    slug: 'sunset-private-charter',
    category: 'private',
    price_display: 'from €310',
    starting_price: 310,
    max_guests: 12,
    duration_display: '1.5 hours',
    title: 'Sunset Private Charter',
    title_nl: 'Zonsondergang Privétocht',
    tagline: 'The city slows down from here.',
    tagline_nl: null,
  },
]

describe('getPublicCruiseList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.order.mockResolvedValue({ data: ROWS })
  })

  it('shapes each row for the requested locale', async () => {
    const result = await getPublicCruiseList('nl')
    expect(result).toEqual([
      {
        slug: 'sunset-private-charter',
        title: 'Zonsondergang Privétocht',
        tagline: 'The city slows down from here.',
        category: 'private',
        priceDisplay: 'from €310',
        startingPrice: 310,
        durationDisplay: '1.5 hours',
        maxGuests: 12,
      },
    ])
  })

  it('returns an empty array when the query returns no rows', async () => {
    h.order.mockResolvedValue({ data: null })
    expect(await getPublicCruiseList('en')).toEqual([])
  })
})
