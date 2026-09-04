import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  profileRows: [
    {
      id: 'prof-1',
      company_name: 'Acme Amsterdam B.V.',
      kvk_number: '12345678',
      vat_number: 'NL123456789B01',
      contact_name: 'John Doe',
      contact_email: 'john@acme.com',
      contact_phone: '+31612345678',
      address_line1: 'Prinsengracht 1',
      postal_code: '1015AA',
      city: 'Amsterdam',
      country_code: 'NL',
    },
  ],
  partnerRows: [
    {
      id: 'part-1',
      name: 'Pulitzer Hotel',
      contact_email: 'concierge@pulitzer.nl',
      contact_phone: '+31201234567',
    },
  ],
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'business_profiles') {
        return {
          select: () => ({
            or: () => ({
              limit: () => Promise.resolve({ data: h.profileRows, error: null }),
            }),
          }),
        }
      }
      if (table === 'partners') {
        return {
          select: () => ({
            ilike: () => ({
              limit: () => Promise.resolve({ data: h.partnerRows, error: null }),
            }),
          }),
        }
      }
      return {
        select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      }
    },
  }),
}))

import { GET } from './route'

function mockReq(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest
}

describe('GET /api/admin/companies/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('rejects unauthenticated requests', async () => {
    const { NextResponse } = await import('next/server')
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(mockReq('https://offcourse.test/api/admin/companies/search?q=acme'))
    expect(res.status).toBe(401)
  })

  it('returns empty array when query is less than 2 characters', async () => {
    const res = await GET(mockReq('https://offcourse.test/api/admin/companies/search?q=a'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.data.results).toEqual([])
  })

  it('finds companies across business_profiles and partners', async () => {
    const res = await GET(mockReq('https://offcourse.test/api/admin/companies/search?q=acme'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.data.results.length).toBeGreaterThan(0)
    expect(json.data.results[0].companyName).toBe('Acme Amsterdam B.V.')
    expect(json.data.results[0].source).toBe('database')
  })
})
