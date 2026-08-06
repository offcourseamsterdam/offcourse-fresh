import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  addGrant: vi.fn(),
  toJwt: vi.fn(() => 'signed.jwt.token'),
  AccessTokenCtor: vi.fn(),
  VoiceGrantCtor: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('twilio', () => {
  class VoiceGrant {
    constructor(opts: unknown) {
      h.VoiceGrantCtor(opts)
    }
  }
  class AccessToken {
    static VoiceGrant = VoiceGrant
    constructor(...args: unknown[]) {
      h.AccessTokenCtor(...args)
    }
    addGrant = h.addGrant
    toJwt = h.toJwt
  }
  return { default: { jwt: { AccessToken } } }
})

import { GET } from './route'

const ENV_BACKUP = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  process.env.TWILIO_ACCOUNT_SID = 'ACxxxx'
  process.env.TWILIO_API_KEY_SID = 'SKxxxx'
  process.env.TWILIO_API_KEY_SECRET = 'secret'
  process.env.TWILIO_TWIML_APP_SID = 'APxxxx'
})

afterEach(() => {
  process.env = { ...ENV_BACKUP }
})

describe('GET /api/admin/voice/token', () => {
  it('issues a token with a VoiceGrant scoped to the beer identity', async () => {
    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual({ token: 'signed.jwt.token', identity: 'beer' })

    expect(h.AccessTokenCtor).toHaveBeenCalledWith('ACxxxx', 'SKxxxx', 'secret', { identity: 'beer', ttl: 3600 })
    expect(h.VoiceGrantCtor).toHaveBeenCalledWith({ outgoingApplicationSid: 'APxxxx', incomingAllow: true })
    expect(h.addGrant).toHaveBeenCalled()
  })

  it('returns the admin auth guard response when not an admin', async () => {
    const denied = new Response(null, { status: 401 }) as never
    h.requireAdmin.mockResolvedValue(denied)

    const res = await GET()
    expect(res).toBe(denied)
    expect(h.AccessTokenCtor).not.toHaveBeenCalled()
  })

  it('returns 503 when Twilio voice env vars are not configured', async () => {
    delete process.env.TWILIO_API_KEY_SID

    const res = await GET()
    expect(res.status).toBe(503)
    expect(h.AccessTokenCtor).not.toHaveBeenCalled()
  })
})
