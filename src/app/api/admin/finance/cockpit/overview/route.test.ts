import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  loadCockpit: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/finance/cockpit/load-cockpit', () => ({ loadCockpit: h.loadCockpit }))

import { GET } from './route'

const url = (qs = '') => new NextRequest(`https://offcourseamsterdam.com/api/admin/finance/cockpit/overview${qs}`)

describe('GET /api/admin/finance/cockpit/overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.loadCockpit.mockResolvedValue({ status: { level: 'healthy' }, financialSpaceCents: 123 })
  })

  it('passes the requireAdmin denial through untouched', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }))
    const res = await GET(url())
    expect(res.status).toBe(401)
    expect(h.loadCockpit).not.toHaveBeenCalled()
  })

  it('rejects an unknown horizon with 400', async () => {
    const res = await GET(url('?horizon=6m'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('horizon')
    expect(h.loadCockpit).not.toHaveBeenCalled()
  })

  it('returns the computed cockpit, using the stored horizon when none is given', async () => {
    const res = await GET(url())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.data.financialSpaceCents).toBe(123)
    expect(h.loadCockpit).toHaveBeenCalledWith({ horizon: undefined })
  })

  it('forwards an explicit horizon override', async () => {
    await GET(url('?horizon=12m'))
    expect(h.loadCockpit).toHaveBeenCalledWith({ horizon: '12m' })
  })

  it('turns a loader failure into a 500 with the message', async () => {
    h.loadCockpit.mockRejectedValueOnce(new Error('db down'))
    const res = await GET(url())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
