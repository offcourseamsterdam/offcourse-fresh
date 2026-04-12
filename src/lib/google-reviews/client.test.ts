import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Must import AFTER mocking fetch
import { fetchGoogleReviews, searchPlace } from './client'

beforeEach(() => {
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-api-key')
  mockFetch.mockReset()
})

// ── fetchGoogleReviews ─────────────────────────────────────────────────────

describe('fetchGoogleReviews', () => {
  it('calls Google Places API with correct URL and headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reviews: [], rating: 4.8, userRatingCount: 120 }),
    })

    await fetchGoogleReviews('ChIJtest123')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJtest123')
    expect(opts.headers['X-Goog-Api-Key']).toBe('test-api-key')
    expect(opts.headers['X-Goog-FieldMask']).toContain('reviews')
  })

  it('returns reviews, rating, and review count', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        reviews: [
          {
            name: 'places/ChIJ/reviews/abc',
            rating: 5,
            text: { text: 'Great boat ride!', languageCode: 'en' },
            authorAttribution: { displayName: 'Jane', uri: '', photoUri: '' },
            publishTime: '2025-01-01T00:00:00Z',
          },
        ],
        rating: 4.8,
        userRatingCount: 120,
      }),
    })

    const result = await fetchGoogleReviews('ChIJtest123')

    expect(result.reviews).toHaveLength(1)
    expect(result.reviews![0].rating).toBe(5)
    expect(result.reviews![0].text.text).toBe('Great boat ride!')
    expect(result.rating).toBe(4.8)
    expect(result.userRatingCount).toBe(120)
  })

  it('throws when API key is missing', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '')

    await expect(fetchGoogleReviews('ChIJtest123')).rejects.toThrow(
      'GOOGLE_PLACES_API_KEY'
    )
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    })

    await expect(fetchGoogleReviews('ChIJtest123')).rejects.toThrow(
      'Google Places API error (403)'
    )
  })
})

// ── searchPlace ────────────────────────────────────────────────────────────

describe('searchPlace', () => {
  it('returns placeId and name for first match', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        places: [
          { id: 'ChIJfound', displayName: { text: 'Off Course Amsterdam' } },
        ],
      }),
    })

    const result = await searchPlace('Off Course Amsterdam')

    expect(result).toEqual({
      placeId: 'ChIJfound',
      name: 'Off Course Amsterdam',
    })
  })

  it('returns null when no places found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ places: [] }),
    })

    const result = await searchPlace('nonexistent business')
    expect(result).toBeNull()
  })

  it('sends POST request with textQuery', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ places: [] }),
    })

    await searchPlace('test query')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('places:searchText')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ textQuery: 'test query' })
  })
})
