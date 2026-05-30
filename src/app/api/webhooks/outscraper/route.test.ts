import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * Tests the Outscraper webhook's security + idempotency invariants:
 *   1. Valid HMAC signature → processes + upserts
 *   2. Bad signature → 401, no DB work
 *   3. Unknown source → 200 no-op
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
      // google_reviews_config: support both the dedup read and the stats update
      return {
        select: () => ({ limit: () => ({ single: h.maybeSingle, maybeSingle: h.maybeSingle }) }),
        update: () => ({ eq: h.configUpdate, limit: h.configUpdate }),
      }
    },
  }),
}))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))

import { POST } from './route'

const API_KEY = 'test-outscraper-key'

function sign(body: string): string {
  return `sha256=${createHmac('sha256', API_KEY).update(body).digest('hex')}`
}

function mockReq(body: string, signature: string, source = 'google'): NextRequest {
  return {
    text: async () => body,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-hub-signature-256' ? signature : null) },
    nextUrl: { searchParams: new URLSearchParams(`source=${source}`) },
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

  it('accepts a valid signature and upserts reviews', async () => {
    const res = await POST(mockReq(VALID_PAYLOAD, sign(VALID_PAYLOAD), 'google'))
    expect(res.status).toBe(200)
    expect(h.upsert).toHaveBeenCalledTimes(1)
    const upsertedRows = h.upsert.mock.calls[0]![0] as Array<{ external_review_id: string; source: string }>
    expect(upsertedRows[0]!.external_review_id).toBe('rev-1')
    expect(upsertedRows[0]!.source).toBe('google')
  })

  it('rejects an invalid signature with 401 and does no DB work', async () => {
    const res = await POST(mockReq(VALID_PAYLOAD, 'sha256=wrong', 'google'))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('skips an unknown source with 200 no-op', async () => {
    const res = await POST(mockReq(VALID_PAYLOAD, sign(VALID_PAYLOAD), 'yelp'))
    expect(res.status).toBe(200)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('skips a duplicate request id without upserting', async () => {
    h.maybeSingle.mockResolvedValue({ data: { id: 'cfg-1', outscraper_processed_ids: ['req-abc'] } })
    const res = await POST(mockReq(VALID_PAYLOAD, sign(VALID_PAYLOAD), 'google'))
    expect(res.status).toBe(200)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})
