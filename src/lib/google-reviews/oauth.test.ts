import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock the Supabase server module (used by getValidAccessToken)
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

import { getGoogleAuthUrl, exchangeCodeForTokens, refreshAccessToken } from './oauth'

beforeEach(() => {
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'test-client-id')
  vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'test-client-secret')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://offcourseamsterdam.com')
  mockFetch.mockReset()
})

// ── getGoogleAuthUrl ───────────────────────────────────────────────────────

describe('getGoogleAuthUrl', () => {
  it('returns a Google OAuth URL with correct params', () => {
    const url = getGoogleAuthUrl('random-state-123')
    const parsed = new URL(url)

    expect(parsed.origin).toBe('https://accounts.google.com')
    expect(parsed.pathname).toBe('/o/oauth2/v2/auth')
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id')
    expect(parsed.searchParams.get('state')).toBe('random-state-123')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
    expect(parsed.searchParams.get('scope')).toContain('business.manage')
  })

  it('includes correct redirect URI', () => {
    const url = getGoogleAuthUrl('state')
    const parsed = new URL(url)

    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://offcourseamsterdam.com/api/admin/reviews/google-auth/callback'
    )
  })

  it('throws when GOOGLE_OAUTH_CLIENT_ID is missing', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', '')

    expect(() => getGoogleAuthUrl('state')).toThrow('GOOGLE_OAUTH_CLIENT_ID')
  })
})

// ── exchangeCodeForTokens ──────────────────────────────────────────────────

describe('exchangeCodeForTokens', () => {
  it('exchanges code and returns tokens', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/business.manage',
      }),
    })

    const tokens = await exchangeCodeForTokens('auth-code-123')

    expect(tokens.access_token).toBe('new-access-token')
    expect(tokens.refresh_token).toBe('new-refresh-token')
    expect(tokens.expires_in).toBe(3600)
  })

  it('sends correct form data to Google token endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'x', expires_in: 3600, token_type: 'Bearer', scope: '' }),
    })

    await exchangeCodeForTokens('my-code')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(opts.method).toBe('POST')

    const body = new URLSearchParams(opts.body)
    expect(body.get('code')).toBe('my-code')
    expect(body.get('client_id')).toBe('test-client-id')
    expect(body.get('client_secret')).toBe('test-client-secret')
    expect(body.get('grant_type')).toBe('authorization_code')
  })

  it('throws on failed exchange', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    })

    await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow(
      'Token exchange failed (400)'
    )
  })
})

// ── refreshAccessToken ─────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  it('refreshes token and returns new access token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'refreshed-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: '',
      }),
    })

    const tokens = await refreshAccessToken('old-refresh-token')

    expect(tokens.access_token).toBe('refreshed-token')
  })

  it('sends refresh_token grant type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'x', expires_in: 3600, token_type: 'Bearer', scope: '' }),
    })

    await refreshAccessToken('my-refresh-token')

    const [, opts] = mockFetch.mock.calls[0]
    const body = new URLSearchParams(opts.body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('my-refresh-token')
  })

  it('throws when refresh is rejected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Token has been revoked',
    })

    await expect(refreshAccessToken('revoked-token')).rejects.toThrow(
      'Token refresh failed (401)'
    )
  })
})
