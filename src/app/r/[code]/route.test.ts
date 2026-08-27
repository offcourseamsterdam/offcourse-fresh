import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

const mockConfigSingle = vi.fn()
const mockBookingMaybeSingle = vi.fn()
const mockInsert = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table === 'google_reviews_config') {
    return { select: () => ({ single: mockConfigSingle }) }
  }
  if (table === 'bookings') {
    return { select: () => ({ eq: () => ({ maybeSingle: mockBookingMaybeSingle }) }) }
  }
  if (table === 'short_url_clicks') {
    return { insert: mockInsert }
  }
  throw new Error(`unexpected table "${table}"`)
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}))

describe('GET /r/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
  })

  it('redirects /r/map to configured recommendations_map_url and logs click', async () => {
    mockConfigSingle.mockResolvedValue({
      data: {
        recommendations_map_url: 'https://maps.app.goo.gl/custom-list',
        tripadvisor_review_url_shared: 'https://www.tripadvisor.com/UserReviewEdit-shared',
        tripadvisor_review_url_private: 'https://www.tripadvisor.com/UserReviewEdit-private',
        tripadvisor_url: 'https://www.tripadvisor.com/Attraction_Review-g188590-d12345',
      },
      error: null,
    })

    const req = new NextRequest('https://offcourseamsterdam.com/r/map?b=book_123', {
      headers: {
        'user-agent': 'Mozilla/5.0 Test Browser',
        'x-forwarded-for': '1.2.3.4',
      },
    })

    const res = await GET(req, { params: Promise.resolve({ code: 'map' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://maps.app.goo.gl/custom-list')
    expect(mockFrom).toHaveBeenCalledWith('short_url_clicks')
    expect(mockFrom).not.toHaveBeenCalledWith('bookings')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'map',
        booking_id: 'book_123',
        destination_url: 'https://maps.app.goo.gl/custom-list',
        user_agent: 'Mozilla/5.0 Test Browser',
      })
    )
  })

  it('redirects /r/review to the SHARED url for a shared-category booking', async () => {
    mockConfigSingle.mockResolvedValue({
      data: {
        recommendations_map_url: null,
        tripadvisor_review_url_shared: 'https://www.tripadvisor.com/UserReviewEdit-shared',
        tripadvisor_review_url_private: 'https://www.tripadvisor.com/UserReviewEdit-private',
        tripadvisor_url: 'https://www.tripadvisor.com/Attraction_Review-g188590-d12345',
      },
      error: null,
    })
    mockBookingMaybeSingle.mockResolvedValue({ data: { category: 'shared' }, error: null })

    const req = new NextRequest('https://offcourseamsterdam.com/r/review?b=book_123')
    const res = await GET(req, { params: Promise.resolve({ code: 'review' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://www.tripadvisor.com/UserReviewEdit-shared')
  })

  it('redirects /r/review to the PRIVATE url for a private-category booking', async () => {
    mockConfigSingle.mockResolvedValue({
      data: {
        recommendations_map_url: null,
        tripadvisor_review_url_shared: 'https://www.tripadvisor.com/UserReviewEdit-shared',
        tripadvisor_review_url_private: 'https://www.tripadvisor.com/UserReviewEdit-private',
        tripadvisor_url: 'https://www.tripadvisor.com/Attraction_Review-g188590-d12345',
      },
      error: null,
    })
    mockBookingMaybeSingle.mockResolvedValue({ data: { category: 'private' }, error: null })

    const req = new NextRequest('https://offcourseamsterdam.com/r/review?b=book_456')
    const res = await GET(req, { params: Promise.resolve({ code: 'review' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://www.tripadvisor.com/UserReviewEdit-private')
  })

  it('falls back to the private url when no booking id is present (no category to resolve)', async () => {
    mockConfigSingle.mockResolvedValue({
      data: {
        recommendations_map_url: null,
        tripadvisor_review_url_shared: 'https://www.tripadvisor.com/UserReviewEdit-shared',
        tripadvisor_review_url_private: 'https://www.tripadvisor.com/UserReviewEdit-private',
        tripadvisor_url: 'https://www.tripadvisor.com/Attraction_Review-g188590-d12345',
      },
      error: null,
    })

    const req = new NextRequest('https://offcourseamsterdam.com/r/review')
    const res = await GET(req, { params: Promise.resolve({ code: 'review' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://www.tripadvisor.com/UserReviewEdit-private')
    expect(mockFrom).not.toHaveBeenCalledWith('bookings')
  })

  it('falls back to tripadvisor_url when neither shared nor private url is configured', async () => {
    mockConfigSingle.mockResolvedValue({
      data: {
        recommendations_map_url: null,
        tripadvisor_review_url_shared: null,
        tripadvisor_review_url_private: null,
        tripadvisor_url: 'https://www.tripadvisor.com/Attraction_Review-g188590-d12345',
      },
      error: null,
    })

    const req = new NextRequest('https://offcourseamsterdam.com/r/review')
    const res = await GET(req, { params: Promise.resolve({ code: 'review' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://www.tripadvisor.com/Attraction_Review-g188590-d12345')
  })

  it('redirects unknown slug to homepage', async () => {
    mockConfigSingle.mockResolvedValue({ data: null, error: null })

    const req = new NextRequest('https://offcourseamsterdam.com/r/unknown')
    const res = await GET(req, { params: Promise.resolve({ code: 'unknown' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://offcourseamsterdam.com/')
  })
})
