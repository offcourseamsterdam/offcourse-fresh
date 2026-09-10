import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAccessToken } from './token-store'
import { encryptSecret, getTokenKey } from './crypto'
import type { RevolutEnvConfig } from './token-store'

const h = vi.hoisted(() => ({ refreshAccessToken: vi.fn() }))
vi.mock('./auth', async importOriginal => {
  const actual = await importOriginal<typeof import('./auth')>()
  return { ...actual, refreshAccessToken: h.refreshAccessToken }
})

process.env.REVOLUT_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64')
const key = getTokenKey()

const env: RevolutEnvConfig = {
  environment: 'sandbox',
  clientId: 'client-1',
  privateKeyPem: 'unused-in-this-test',
  redirectUri: 'https://example.com/callback',
  scopes: ['READ', 'WRITE'],
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'default',
    refresh_token_enc: encryptSecret('refresh-token', key),
    access_token_enc: encryptSecret('stale-access-token', key),
    access_token_expires_at: new Date(Date.now() - 60_000).toISOString(), // already expired
    consented_at: '2026-09-01T00:00:00Z',
    refresh_lock_until: null,
    last_sync_error: 'token refresh: Revolut token request failed (401): signature mismatch',
    ...overrides,
  }
}

/** A minimal fake of the chain the module actually calls, recording every update patch. */
function makeSupabase(row: ReturnType<typeof makeRow>) {
  const updates: Record<string, unknown>[] = []
  const supabase = {
    from: (_table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(patch)
          Object.assign(row, patch)
          return { error: null }
        },
      }),
    }),
    rpc: async () => ({ data: true }),
  }
  return { supabase, updates }
}

describe('getAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears a stale last_sync_error once the refresh succeeds', async () => {
    const row = makeRow()
    const { supabase, updates } = makeSupabase(row)
    h.refreshAccessToken.mockResolvedValue({ access_token: 'fresh-token', token_type: 'bearer', expires_in: 2400 })

    const token = await getAccessToken(supabase as never, { env })

    expect(token).toBe('fresh-token')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ last_sync_error: null })
    expect(row.last_sync_error).toBeNull()
  })

  it('records the failure on last_sync_error when the refresh itself fails', async () => {
    const row = makeRow({ last_sync_error: null })
    const { supabase, updates } = makeSupabase(row)
    h.refreshAccessToken.mockRejectedValue(new Error('Revolut token request failed (401): signature mismatch'))

    await expect(getAccessToken(supabase as never, { env })).rejects.toThrow('signature mismatch')

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ last_sync_error: expect.stringContaining('signature mismatch') })
  })
})
