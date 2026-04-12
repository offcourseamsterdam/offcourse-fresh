import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import {
  listAccounts,
  listLocations,
  replyToReview,
  deleteReply,
  extractReviewId,
} from './business-profile'

beforeEach(() => {
  mockFetch.mockReset()
})

// ── extractReviewId ────────────────────────────────────────────────────────

describe('extractReviewId', () => {
  it('extracts review ID from standard Places API resource name', () => {
    expect(
      extractReviewId('places/ChIJtest123/reviews/ChdDSUreviewId')
    ).toBe('ChdDSUreviewId')
  })

  it('handles review IDs with slashes', () => {
    expect(
      extractReviewId('places/ChIJ-abc_123/reviews/review-with-dashes')
    ).toBe('review-with-dashes')
  })

  it('returns null for empty string', () => {
    expect(extractReviewId('')).toBeNull()
  })

  it('returns null for malformed resource name', () => {
    expect(extractReviewId('not-a-valid-format')).toBeNull()
  })

  it('returns null for partial path without places/ prefix', () => {
    expect(extractReviewId('reviews/abc')).toBeNull()
  })

  it('returns null for path without reviews segment', () => {
    expect(extractReviewId('places/ChIJ123/something/else')).toBeNull()
  })
})

// ── listAccounts ───────────────────────────────────────────────────────────

describe('listAccounts', () => {
  it('returns accounts array from API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accounts: [
          { name: 'accounts/123', accountName: 'Test', type: 'PERSONAL', role: 'OWNER' },
        ],
      }),
    })

    const accounts = await listAccounts('token-123')

    expect(accounts).toHaveLength(1)
    expect(accounts[0].name).toBe('accounts/123')
  })

  it('returns empty array when no accounts exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    const accounts = await listAccounts('token-123')
    expect(accounts).toEqual([])
  })

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    await expect(listAccounts('bad-token')).rejects.toThrow('List accounts failed (401)')
  })

  it('sends correct authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accounts: [] }),
    })

    await listAccounts('my-token')

    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Bearer my-token')
  })
})

// ── listLocations ──────────────────────────────────────────────────────────

describe('listLocations', () => {
  it('returns locations for an account', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        locations: [
          { name: 'locations/456', title: 'Off Course Amsterdam' },
        ],
      }),
    })

    const locations = await listLocations('token', 'accounts/123')

    expect(locations).toHaveLength(1)
    expect(locations[0].title).toBe('Off Course Amsterdam')
  })

  it('includes readMask in URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ locations: [] }),
    })

    await listLocations('token', 'accounts/123')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('readMask=')
    expect(url).toContain('accounts/123/locations')
  })
})

// ── replyToReview ──────────────────────────────────────────────────────────

describe('replyToReview', () => {
  it('sends PUT request with comment body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ comment: 'Thanks!', updateTime: '2025-01-01T00:00:00Z' }),
    })

    const reply = await replyToReview(
      'token', 'accounts/1', 'locations/2', 'reviewId3', 'Thanks!'
    )

    expect(reply.comment).toBe('Thanks!')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('accounts/1/locations/2/reviews/reviewId3/reply')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ comment: 'Thanks!' })
  })

  it('throws on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    })

    await expect(
      replyToReview('token', 'a/1', 'l/2', 'r3', 'text')
    ).rejects.toThrow('Reply failed (404)')
  })
})

// ── deleteReply ────────────────────────────────────────────────────────────

describe('deleteReply', () => {
  it('sends DELETE request', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })

    await deleteReply('token', 'accounts/1', 'locations/2', 'reviewId3')

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('reviews/reviewId3/reply')
    expect(opts.method).toBe('DELETE')
  })

  it('throws on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    })

    await expect(
      deleteReply('token', 'a/1', 'l/2', 'r3')
    ).rejects.toThrow('Delete reply failed (403)')
  })
})
