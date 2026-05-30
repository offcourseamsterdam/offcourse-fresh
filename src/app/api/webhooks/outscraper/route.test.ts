import { describe, it, expect, vi, beforeEach } from 'vitest'
import { outscraperWebhookToken } from '@/lib/outscraper/webhook-token'
import type { NextRequest } from 'next/server'

/**
 * Tests the Outscraper webhook's auth + idempotency invariants:
 *   1. Valid URL token → processes + upserts
 *   2. Bad token (no HMAC) → 401, no DB work
 *   3. Unknown source → 200 no-op
 *   4. Duplicate request id → 200, no upsert
 */

const h = vi.hoisted(() => ({
  upsert: vi.fn().mockResolvedValue({ error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'cfg-1', outscraper_processed_ids: [] } }),
  configUpdate: vi.fn().mockResolvedValue({ error: null }),
  postSlackText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'social_proof_reviews') {
        return { upsert: h.upsert }
      }
      return {
        select: () => ({ limit: () => ({ single: h.maybeSingle, maybeSingle: h.maybeSingle }) }),
        update: () => ({ eq: h.configUpdate, limit: h.configUpdate, not: h.configUpdate }),
      }
    },
  }),
}))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))

import { POST } from './route'

const API_KEY = 'test-outscraper-key'
const TOKEN = outscraperWebhookToken(API_KEY)

function mockReq(
  body: string,
  { source = 'google', token = TOKEN as string }: { source?: string; token?: string } = {}
): NextRequest {
  const params = new URLSearchParams()
  params.set('source', source)
  if (token) params.set('token', token)
  return {
    text: async () => body,
    headers: { get: () => null }, // token auth, no HMAC header
    nextUrl: { searchParams: params },
  } as unknown as NextRequest
}

const VALID_PAYLOAD = JSON.stringify({
  id: 'req-abc',
  status: 'Success',
  data: [
    {
      rating: 4.9,
      reviews: 100,
      reviews_data: [
        {
          reviews_id: 'rev-1',
          author_title: 'Test User',
          review_text: 'Loved it',
          review_rating: 5,
          review_datetime_utc: '03/17/2021 17:08:18',
          review_img_urls: [],
        },
      ],
    },
  ],
})

describe('outscraper webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('OUTSCRAPER_API_KEY', API_KEY)
    h.maybeSingle.mockResolvedValue({ data: { id: 'cfg-1', outscraper_processed_ids: [] } })
  })

  it('accepts a valid token and upserts reviews', async () => {
    const res = await POST(mockReq(VALID_PAYLOAD))
    expect(res.status).toBe(200)
    expect(h.upsert).toHaveBeenCalledTimes(1)
    const rows = h.upsert.mock.calls[0]![0] as Array<{ external_review_id: string; source: string }>
    expect(rows[0]!.external_review_id).toBe('rev-1')
    expect(rows[0]!.source).toBe('google')
  })

  it('rejects a bad token with 401 and does no DB work', async () => {
    const res = await POST(mockReq(VALID_PAYLOAD, { token: 'wrong-token' }))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('skips an unknown source with 200 no-op', async () => {
    const res = await POST(mockReq(VALID_PAYLOAD, { source: 'yelp' }))
    expect(res.status).toBe(200)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('skips a duplicate request id without upserting', async () => {
    h.maybeSingle.mockResolvedValue({ data: { id: 'cfg-1', outscraper_processed_ids: ['req-abc'] } })
    const res = await POST(mockReq(VALID_PAYLOAD))
    expect(res.status).toBe(200)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})
