import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

import { POST } from './route'

function mockReq(body: object): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

describe('POST /api/admin/companies/validate-vat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('rejects unauthenticated requests', async () => {
    const { NextResponse } = await import('next/server')
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await POST(mockReq({ vatNumber: 'NL123456789B01' }))
    expect(res.status).toBe(401)
  })

  it('returns invalid for empty VAT number', async () => {
    const res = await POST(mockReq({ vatNumber: '' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('validates syntax format and extracts country', async () => {
    // Mock global fetch for VIES
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        isValid: true,
        name: 'TEST BEDRIJF B.V.',
        address: 'KEIZERSGRACHT 100\n1015AA AMSTERDAM',
      }),
    }) as unknown as typeof fetch

    try {
      const res = await POST(mockReq({ vatNumber: 'NL 8545.12.345.B01' }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
      expect(json.data.isValid).toBe(true)
      expect(json.data.companyName).toBe('TEST BEDRIJF B.V.')
    } finally {
      global.fetch = originalFetch
    }
  })
})
