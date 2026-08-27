import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

// Mock supabaseAdmin
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  insert: mockInsert,
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}))

describe('GET /r/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects /r/map to configured recommendations_map_url and logs click', async () => {
    mockSelect.mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          recommendations_map_url: 'https://maps.app.goo.gl/custom-list',
          tripadvisor_review_url: 'https://www.tripadvisor.com/UserReviewEdit-g188590-d12345',
          tripadvisor_url: 'https://www.tripadvisor.com/Attraction_Review-g188590-d12345',
        },
        error: null,
      }),
    })
    mockInsert.mockResolvedValue({ error: null })

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
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'map',
        booking_id: 'book_123',
        destination_url: 'https://maps.app.goo.gl/custom-list',
        user_agent: 'Mozilla/5.0 Test Browser',
      })
    )
  })

  it('redirects /r/review to tripadvisor_review_url', async () => {
    mockSelect.mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          recommendations_map_url: null,
          tripadvisor_review_url: 'https://www.tripadvisor.com/UserReviewEdit-g188590-d12345',
          tripadvisor_url: 'https://www.tripadvisor.com/Attraction_Review-g188590-d12345',
        },
        error: null,
      }),
    })
    mockInsert.mockResolvedValue({ error: null })

    const req = new NextRequest('https://offcourseamsterdam.com/r/review')
    const res = await GET(req, { params: Promise.resolve({ code: 'review' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://www.tripadvisor.com/UserReviewEdit-g188590-d12345')
  })

  it('falls back to tripadvisor_url when tripadvisor_review_url is not set', async () => {
    mockSelect.mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: {
          recommendations_map_url: null,
          tripadvisor_review_url: null,
          tripadvisor_url: 'https://www.tripadvisor.com/Attraction_Review-g188590-d12345',
        },
        error: null,
      }),
    })
    mockInsert.mockResolvedValue({ error: null })

    const req = new NextRequest('https://offcourseamsterdam.com/r/review')
    const res = await GET(req, { params: Promise.resolve({ code: 'review' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://www.tripadvisor.com/Attraction_Review-g188590-d12345')
  })

  it('redirects unknown slug to homepage', async () => {
    mockSelect.mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    mockInsert.mockResolvedValue({ error: null })

    const req = new NextRequest('https://offcourseamsterdam.com/r/unknown')
    const res = await GET(req, { params: Promise.resolve({ code: 'unknown' }) })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://offcourseamsterdam.com/')
  })
})
