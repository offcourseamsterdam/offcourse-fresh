import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }) }) }),
    }),
  }),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

import { GET } from './route'

function mockReq(query: string): NextRequest {
  return {
    url: `http://localhost/api/admin/booking-flow/invoice-suggestion?${query}`,
  } as unknown as NextRequest
}

describe('GET /api/admin/booking-flow/invoice-suggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.maybeSingle.mockResolvedValue({ data: null })
  })

  it('requires admin auth', async () => {
    await GET(mockReq('partnerId=p1&listingId=l1&baseAmountCents=10000'))
    expect(h.requireAdmin).toHaveBeenCalledTimes(1)
  })

  it('400s when partnerId or listingId is missing', async () => {
    const res = await GET(mockReq('baseAmountCents=10000'))
    expect(res.status).toBe(400)
  })

  it('suggests base minus commission when an active percentage campaign exists', async () => {
    h.maybeSingle.mockResolvedValue({ data: { percentage_value: 15, investment_type: 'percentage' } })

    const res = await GET(mockReq('partnerId=p1&listingId=l1&baseAmountCents=10000'))
    const json = await res.json()

    expect(json.data).toEqual({
      suggestedInvoiceCents: 8500,
      suggestedCommissionCents: 1500,
      hasCampaign: true,
      commissionPercent: 15,
    })
  })

  it('defaults to the full amount when no active campaign exists', async () => {
    h.maybeSingle.mockResolvedValue({ data: null })

    const res = await GET(mockReq('partnerId=p1&listingId=l1&baseAmountCents=10000'))
    const json = await res.json()

    expect(json.data).toEqual({
      suggestedInvoiceCents: 10000,
      suggestedCommissionCents: 0,
      hasCampaign: false,
      commissionPercent: null,
    })
  })
})
