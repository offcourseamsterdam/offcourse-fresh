import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `server-only` throws when imported outside a server bundle; stub it for the runner.
vi.mock('server-only', () => ({}))

// Capture apiError as a plain sentinel so we assert status without building a real NextResponse.
vi.mock('@/lib/api/response', () => ({
  apiError: vi.fn((message: string, status: number) => ({ __denied: true, message, status })),
}))

// Controllable profile source.
vi.mock('@/lib/auth/server', () => ({ getUserProfile: vi.fn() }))

import { getUserProfile } from '@/lib/auth/server'
import { requireAdmin } from './require-admin'

const mockGetUserProfile = vi.mocked(getUserProfile)

describe('requireAdmin', () => {
  beforeEach(() => {
    mockGetUserProfile.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('bypasses auth in development and never queries the profile', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await requireAdmin()
    expect(res).toBeNull()
    expect(mockGetUserProfile).not.toHaveBeenCalled()
  })

  it('denies with 401 when there is no authenticated profile (production)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockGetUserProfile.mockResolvedValue(null)
    expect(await requireAdmin()).toMatchObject({ __denied: true, status: 401 })
  })

  it('denies with 403 when the account is deactivated', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    // @ts-expect-error partial profile is enough for the guard's checks
    mockGetUserProfile.mockResolvedValue({ role: 'admin', is_active: false })
    expect(await requireAdmin()).toMatchObject({ __denied: true, status: 403 })
  })

  it('denies with 403 when the role is not admin', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    // @ts-expect-error partial profile is enough for the guard's checks
    mockGetUserProfile.mockResolvedValue({ role: 'support', is_active: true })
    expect(await requireAdmin()).toMatchObject({ __denied: true, status: 403 })
  })

  it('allows an active admin (returns null) in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    // @ts-expect-error partial profile is enough for the guard's checks
    mockGetUserProfile.mockResolvedValue({ role: 'admin', is_active: true })
    expect(await requireAdmin()).toBeNull()
  })

  it('treats preview/staging (non-development) as production for enforcement', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    mockGetUserProfile.mockResolvedValue(null)
    // Any non-"development" env must enforce, never bypass.
    expect(await requireAdmin()).toMatchObject({ __denied: true, status: 401 })
  })
})
