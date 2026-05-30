import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

beforeEach(() => {
  vi.stubEnv('OUTSCRAPER_API_KEY', 'test-api-key')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('FAREHARBOR_API_APP', 'fh-app')
  vi.stubEnv('FAREHARBOR_API_USER', 'fh-user')
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_x')
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_x')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('scrapeGoogleReviews', () => {
  it('calls Outscraper with X-API-Key header and correct params', async () => {
    const mockResponse = { id: 'req-123', status: 'Pending' }
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      void init
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { scrapeGoogleReviews } = await import('./client')
    const result = await scrapeGoogleReviews({ placeId: 'ChIJtest', webhookUrl: 'https://example.com/webhook' })

    expect(result).toEqual(mockResponse)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('maps/reviews-v3')
    expect(url).toContain('query=ChIJtest')
    expect(url).toContain('sort=newest')
    expect(url).toContain('async=true')
    expect(url).toContain('webhook=')
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('test-api-key')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('scrapeTripadvisorReviews', () => {
  it('calls TripAdvisor endpoint with correct params', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'req-456', status: 'Pending' }) } as Response)
    )
    vi.stubGlobal('fetch', fetchMock)

    const { scrapeTripadvisorReviews } = await import('./client')
    await scrapeTripadvisorReviews({ listingUrl: 'https://www.tripadvisor.com/...', webhookUrl: 'https://example.com/webhook' })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('tripadvisor-reviews')
    expect(url).toContain('limit=')
    expect(url).toContain('async=true')
  })
})
