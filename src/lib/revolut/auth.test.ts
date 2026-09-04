import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import {
  buildAuthorizeUrl,
  buildClientAssertion,
  exchangeAuthorizationCode,
  issuerFromRedirectUri,
  normalizePrivateKey,
  redact,
  refreshAccessToken,
} from './auth'
import { fromB64url } from './crypto'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const REDIRECT = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/revolut/callback'

describe('issuerFromRedirectUri', () => {
  it('is the bare hostname of the redirect URI (what Revolut expects as iss)', () => {
    expect(issuerFromRedirectUri(REDIRECT)).toBe('offcourseamsterdam.com')
    expect(issuerFromRedirectUri('https://example.com')).toBe('example.com')
  })
})

describe('buildAuthorizeUrl', () => {
  it('points at app-confirm with client id, redirect and scopes', () => {
    const u = new URL(buildAuthorizeUrl({ environment: 'production', clientId: 'cid', redirectUri: REDIRECT, scopes: ['READ', 'WRITE'] }))
    expect(u.origin + u.pathname).toBe('https://business.revolut.com/app-confirm')
    expect(u.searchParams.get('client_id')).toBe('cid')
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('scope')).toBe('READ,WRITE')
  })
  it('uses the sandbox host in sandbox', () => {
    expect(buildAuthorizeUrl({ environment: 'sandbox', clientId: 'c', redirectUri: REDIRECT })).toContain('sandbox-business.revolut.com')
  })
})

describe('buildClientAssertion', () => {
  it('produces an RS256 JWT with iss=redirect domain, sub=client id, aud=https://revolut.com', () => {
    const now = new Date('2026-09-04T10:00:00Z')
    const jwt = buildClientAssertion({ clientId: 'zfTKV9Eie', redirectUri: REDIRECT, privateKeyPem: PEM, now, ttlSeconds: 120 })
    const [h, p, s] = jwt.split('.')
    expect(JSON.parse(fromB64url(h).toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const payload = JSON.parse(fromB64url(p).toString())
    const iat = Math.floor(now.getTime() / 1000)
    expect(payload).toEqual({
      iss: 'offcourseamsterdam.com',
      sub: 'zfTKV9Eie',
      aud: 'https://revolut.com',
      iat,
      exp: iat + 120,
    })
    expect(typeof payload.exp).toBe('number') // Revolut rejects exp as a string
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${h}.${p}`)
    expect(verifier.verify(publicKey, fromB64url(s))).toBe(true)
  })
})

describe('normalizePrivateKey', () => {
  it('accepts a PEM, a PEM with escaped newlines, and a base64-encoded PEM', () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM.trim())
    expect(normalizePrivateKey(PEM.replace(/\n/g, '\\n'))).toBe(PEM.trim())
    expect(normalizePrivateKey(Buffer.from(PEM).toString('base64'))).toBe(PEM.trim())
  })
})

describe('token calls', () => {
  const okResponse = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response

  it('exchangeAuthorizationCode posts the right form to the environment base', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ access_token: 'oa_sand_a', token_type: 'bearer', expires_in: 2399, refresh_token: 'oa_sand_r' }))
    const res = await exchangeAuthorizationCode({ environment: 'sandbox', clientId: 'cid', redirectUri: REDIRECT, privateKeyPem: PEM, code: 'oa_sand_code', fetchImpl })
    expect(res.refresh_token).toBe('oa_sand_r')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://sandbox-b2b.revolut.com/api/1.0/auth/token')
    const form = new URLSearchParams(init.body as string)
    expect(form.get('grant_type')).toBe('authorization_code')
    expect(form.get('code')).toBe('oa_sand_code')
    expect(form.get('client_id')).toBe('cid')
    expect(form.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
    expect(form.get('client_assertion')?.split('.')).toHaveLength(3)
    expect(init.cache).toBe('no-store')
  })

  it('refreshAccessToken uses the refresh_token grant', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ access_token: 'oa_prod_new', token_type: 'bearer', expires_in: 2399 }))
    const res = await refreshAccessToken({ environment: 'production', clientId: 'cid', redirectUri: REDIRECT, privateKeyPem: PEM, refreshToken: 'oa_prod_r', fetchImpl })
    expect(res.access_token).toBe('oa_prod_new')
    const form = new URLSearchParams(fetchImpl.mock.calls[0][1].body as string)
    expect(form.get('grant_type')).toBe('refresh_token')
    expect(form.get('refresh_token')).toBe('oa_prod_r')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://b2b.revolut.com/api/1.0/auth/token')
  })

  it('throws a redacted error on a non-2xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid code oa_prod_abcDEF123' } as Response)
    await expect(refreshAccessToken({ environment: 'production', clientId: 'c', redirectUri: REDIRECT, privateKeyPem: PEM, refreshToken: 'r', fetchImpl }))
      .rejects.toThrow(/401.*oa_prod_\[redacted\]/)
  })

  it('rejects a malformed token body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ nope: true }))
    await expect(refreshAccessToken({ environment: 'production', clientId: 'c', redirectUri: REDIRECT, privateKeyPem: PEM, refreshToken: 'r', fetchImpl })).rejects.toThrow(/missing access_token/)
  })
})

describe('redact', () => {
  it('masks tokens and codes', () => {
    expect(redact('code=oa_prod_x1-y2_z3 token oa_sand_abc')).toBe('code=oa_prod_[redacted] token oa_sand_[redacted]')
  })
})
