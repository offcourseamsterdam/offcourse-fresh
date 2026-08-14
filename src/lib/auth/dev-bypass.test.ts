import { describe, it, expect, afterEach, vi } from 'vitest'
import { isAdminDevBypassEnabled } from './dev-bypass'

describe('isAdminDevBypassEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is disabled when the secret/email env vars are missing', () => {
    vi.stubEnv('ADMIN_DEV_BYPASS_SECRET', '')
    vi.stubEnv('ADMIN_DEV_BYPASS_EMAIL', '')
    expect(isAdminDevBypassEnabled()).toBe(false)
  })

  it('is disabled when only one of the two env vars is set', () => {
    vi.stubEnv('ADMIN_DEV_BYPASS_SECRET', 'shh')
    vi.stubEnv('ADMIN_DEV_BYPASS_EMAIL', '')
    expect(isAdminDevBypassEnabled()).toBe(false)
  })

  it('is enabled on localhost even when a stale VERCEL_ENV=production leaks in from `vercel env pull`', () => {
    vi.stubEnv('ADMIN_DEV_BYPASS_SECRET', 'shh')
    vi.stubEnv('ADMIN_DEV_BYPASS_EMAIL', 'admin@example.com')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NODE_ENV', 'development')
    expect(isAdminDevBypassEnabled()).toBe(true)
  })

  it('is enabled on a Vercel preview deployment', () => {
    vi.stubEnv('ADMIN_DEV_BYPASS_SECRET', 'shh')
    vi.stubEnv('ADMIN_DEV_BYPASS_EMAIL', 'admin@example.com')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NODE_ENV', 'production')
    expect(isAdminDevBypassEnabled()).toBe(true)
  })

  it('is hard-blocked on a real Vercel production deployment even if the env vars are set', () => {
    vi.stubEnv('ADMIN_DEV_BYPASS_SECRET', 'shh')
    vi.stubEnv('ADMIN_DEV_BYPASS_EMAIL', 'admin@example.com')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NODE_ENV', 'production')
    expect(isAdminDevBypassEnabled()).toBe(false)
  })
})
