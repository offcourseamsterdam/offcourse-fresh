import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(() => ({})),
  classifyPending: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
// Row selection and the per-row pipeline live in classifyPending (apply.ts),
// tested in classify-pending.test.ts; this route only validates and delegates.
vi.mock('@/lib/finance/cockpit/classify/apply', () => ({ classifyPending: h.classifyPending }))

import { POST } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/transactions/classify-batch'
const req = (body?: unknown) => new NextRequest(BASE, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

describe('/api/admin/finance/cockpit/transactions/classify-batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.classifyPending.mockResolvedValue({ processed: 3, classified: 1, needsReview: 1, unresolved: 1, remaining: false })
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await POST(req({}))).status).toBe(401)
    expect(h.classifyPending).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range limit', async () => {
    expect((await POST(req({ limit: 0 }))).status).toBe(400)
    expect((await POST(req({ limit: 501 }))).status).toBe(400)
    expect((await POST(req({ limit: 1.5 }))).status).toBe(400)
    expect(h.classifyPending).not.toHaveBeenCalled()
  })

  it('defaults to 50 and passes an explicit limit (max 500) through', async () => {
    await POST(req({}))
    expect(h.classifyPending).toHaveBeenLastCalledWith(expect.anything(), { limit: 50 })
    await POST(req({ limit: 500 }))
    expect(h.classifyPending).toHaveBeenLastCalledWith(expect.anything(), { limit: 500 })
  })

  it('returns the tallies', async () => {
    const res = await POST(req({ limit: 3 }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ processed: 3, classified: 1, needsReview: 1, unresolved: 1 })
  })
})
