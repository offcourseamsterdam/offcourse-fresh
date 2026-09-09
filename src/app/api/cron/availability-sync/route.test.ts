import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireCronSecret: vi.fn(),
  syncAllCruisesAvailability: vi.fn(),
  alertCronFailure: vi.fn(),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({
  requireCronSecret: mocks.requireCronSecret,
}))

vi.mock('@/lib/fareharbor/sync-availability', () => ({
  syncAllCruisesAvailability: mocks.syncAllCruisesAvailability,
}))

vi.mock('@/lib/cron/alert', () => ({
  alertCronFailure: mocks.alertCronFailure,
}))

import { GET, POST } from './route'

describe('GET /api/cron/availability-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects request when requireCronSecret returns error response', async () => {
    mocks.requireCronSecret.mockReturnValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

    const req = { nextUrl: new URL('http://localhost:3000/api/cron/availability-sync') } as unknown as NextRequest
    const res = await GET(req)

    expect(res.status).toBe(401)
    expect(mocks.syncAllCruisesAvailability).not.toHaveBeenCalled()
  })

  it('runs syncAllCruisesAvailability and returns 200 when authorized', async () => {
    mocks.requireCronSecret.mockReturnValue(null)
    mocks.syncAllCruisesAvailability.mockResolvedValue({
      success: true,
      syncedListingsCount: 5,
      updatedSlugs: ['classic-boat-tour'],
      syncedAt: '2026-09-09T10:00:00.000Z',
    })

    const req = { nextUrl: new URL('http://localhost:3000/api/cron/availability-sync') } as unknown as NextRequest
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.syncedListingsCount).toBe(5)
    expect(mocks.syncAllCruisesAvailability).toHaveBeenCalledWith(14)
  })

  it('handles errors, alerts Slack, and returns 500', async () => {
    mocks.requireCronSecret.mockReturnValue(null)
    mocks.syncAllCruisesAvailability.mockRejectedValue(new Error('FareHarbor connection timeout'))

    const req = { nextUrl: new URL('http://localhost:3000/api/cron/availability-sync') } as unknown as NextRequest
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.ok).toBe(false)
    expect(json.error).toContain('FareHarbor connection timeout')
    expect(mocks.alertCronFailure).toHaveBeenCalledWith('availability-sync', expect.any(Error))
  })

  it('supports POST as an alias', async () => {
    mocks.requireCronSecret.mockReturnValue(null)
    mocks.syncAllCruisesAvailability.mockResolvedValue({ success: true })

    const req = { nextUrl: new URL('http://localhost:3000/api/cron/availability-sync') } as unknown as NextRequest
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mocks.syncAllCruisesAvailability).toHaveBeenCalled()
  })
})
