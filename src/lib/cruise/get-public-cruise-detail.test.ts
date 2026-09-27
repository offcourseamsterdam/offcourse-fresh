import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPublicCruiseDetail } from './get-public-cruise-detail'

const h = vi.hoisted(() => ({
  getListingBySlug: vi.fn(),
  fhMaybeSingle: vi.fn(),
}))

vi.mock('@/lib/cruise/get-cruise-page-data', () => ({
  getListingBySlug: h.getListingBySlug,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'fareharbor_items') {
        return { select: () => ({ eq: () => ({ maybeSingle: h.fhMaybeSingle }) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

const LISTING = {
  slug: 'book-curacao-boat-tour-amsterdam',
  category: 'private',
  hero_image_url: 'https://example.com/hero.jpg',
  fareharbor_item_pk: 12345,
  allowed_customer_type_pks: [1, 2],
  highlights: [{ text: 'Free Cancellation' }, { text: 'Local Captains' }],
  price_display: 'from €310',
  starting_price: 310,
  max_guests: 12,
  duration_display: '1.5 hours',
  departure_location: 'Brouwersgracht, opposite nr. 64',
  title: 'Book the Curaçao',
  title_nl: 'Boek de Curaçao',
  tagline: 'Just you and the good spots.',
  tagline_nl: null,
  description: '<p>Join a local captain.</p>',
  description_nl: null,
  faqs: [{ question: 'Where do we meet?', answer: 'At the jetty.' }],
  faqs_nl: null,
}

const RAW_CUSTOMER_TYPES = [
  { name: 'Diana 1.5h', customer_type_pk: 1, price_cents: 31000 },
  { name: 'Diana 2h', customer_type_pk: 2, price_cents: 40000 },
  { name: 'Curaçao 1.5h', customer_type_pk: 3, price_cents: 31500 },
]

describe('getPublicCruiseDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getListingBySlug.mockResolvedValue(LISTING)
    h.fhMaybeSingle.mockResolvedValue({ data: { customer_types: RAW_CUSTOMER_TYPES } })
  })

  it('returns null when the listing does not exist', async () => {
    h.getListingBySlug.mockResolvedValue(null)
    const result = await getPublicCruiseDetail('missing', 'en')
    expect(result).toBeNull()
  })

  it('shapes the listing fields for the requested locale', async () => {
    const result = await getPublicCruiseDetail('book-curacao-boat-tour-amsterdam', 'nl')
    expect(result?.title).toBe('Boek de Curaçao')
    // tagline_nl is null, falls back to the English tagline
    expect(result?.tagline).toBe('Just you and the good spots.')
  })

  it('filters customer types to the listing\'s allowed_customer_type_pks (Layer 2)', async () => {
    const result = await getPublicCruiseDetail('book-curacao-boat-tour-amsterdam', 'en')
    expect(result?.customerTypes).toEqual([RAW_CUSTOMER_TYPES[0], RAW_CUSTOMER_TYPES[1]])
  })

  it('flattens highlights to plain strings', async () => {
    const result = await getPublicCruiseDetail('book-curacao-boat-tour-amsterdam', 'en')
    expect(result?.highlights).toEqual(['Free Cancellation', 'Local Captains'])
  })

  it('skips the fareharbor_items lookup when the listing has no fareharbor_item_pk', async () => {
    h.getListingBySlug.mockResolvedValue({ ...LISTING, fareharbor_item_pk: null })
    const result = await getPublicCruiseDetail('book-curacao-boat-tour-amsterdam', 'en')
    expect(result?.customerTypes).toEqual([])
    expect(h.fhMaybeSingle).not.toHaveBeenCalled()
  })

  it('keeps the description as raw HTML for the caller to convert', async () => {
    const result = await getPublicCruiseDetail('book-curacao-boat-tour-amsterdam', 'en')
    expect(result?.descriptionHtml).toBe('<p>Join a local captain.</p>')
  })
})
