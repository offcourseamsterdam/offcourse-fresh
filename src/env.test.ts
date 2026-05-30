import { describe, it, expect, vi, afterEach } from 'vitest'

// `server-only` throws outside a Next.js server bundle; stub it for the runner.
// (vitest.config.ts already aliases it to the empty stub module)

const REQUIRED_VARS = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  FAREHARBOR_API_APP: 'app-key',
  FAREHARBOR_API_USER: 'user-key',
  STRIPE_SECRET_KEY: 'sk_test_xxx',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_xxx',
  STRIPE_WEBHOOK_SECRET: 'whsec_xxx',
}

describe('env validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules() // re-evaluate env.ts on each test
  })

  it('accepts a valid environment and fills defaults', async () => {
    for (const [k, v] of Object.entries(REQUIRED_VARS)) vi.stubEnv(k, v)
    const { env } = await import('./env')
    expect(env.FAREHARBOR_API_BASE).toBe('https://fareharbor.com/api/v1')
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000')
    expect(env.GOOGLE_ADS_REQUIRE_CONSENT).toBe('true')
  })

  it('throws a clear error listing every missing required var', async () => {
    // The global setup pre-sets required vars; blank these out to simulate missing config.
    // z.string().min(1) rejects empty strings the same way it rejects absent vars.
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    vi.stubEnv('FAREHARBOR_API_APP', '')
    await expect(() => import('./env')).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY|FAREHARBOR_API_APP/)
  })

  it('throws when NEXT_PUBLIC_SUPABASE_URL is not a valid URL', async () => {
    for (const [k, v] of Object.entries(REQUIRED_VARS)) vi.stubEnv(k, v)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not-a-url')
    await expect(() => import('./env')).rejects.toThrow(/URL/)
  })

  it('allows optional vars to be absent without throwing', async () => {
    for (const [k, v] of Object.entries(REQUIRED_VARS)) vi.stubEnv(k, v)
    const { env } = await import('./env')
    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(env.SLACK_WEBHOOK_URL).toBeUndefined()
    expect(env.GOOGLE_ADS_DEVELOPER_TOKEN).toBeUndefined()
  })
})
