/**
 * Revolut Business API — OAuth with a JWT client assertion.
 *
 * Verified against developer.revolut.com on 2026-09-04:
 * - Consent URL: https://business.revolut.com/app-confirm?client_id=…&redirect_uri=…&response_type=code[&scope=READ,WRITE]
 *   (sandbox: https://sandbox-business.revolut.com/app-confirm). The code is valid for 2 minutes.
 * - Token endpoint: POST {base}/auth/token, x-www-form-urlencoded, with
 *   client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer.
 * - Client assertion JWT, RS256: iss = the DOMAIN of the OAuth redirect URI (no scheme),
 *   sub = client ID, aud = "https://revolut.com", exp = unix seconds.
 * - access_token expires in 40 minutes; refresh_token does not expire; refreshing
 *   INVALIDATES the previous access token (so tokens must live in one shared store).
 *
 * This module is pure I/O against Revolut: no database, no process-level cache.
 * Storage lives in token-store.ts.
 */

import { createSign } from 'node:crypto'
import { b64url } from './crypto'

export type RevolutEnvironment = 'sandbox' | 'production'

export const REVOLUT_API_BASE: Record<RevolutEnvironment, string> = {
  sandbox: 'https://sandbox-b2b.revolut.com/api/1.0',
  production: 'https://b2b.revolut.com/api/1.0',
}

export const REVOLUT_CONSENT_BASE: Record<RevolutEnvironment, string> = {
  sandbox: 'https://sandbox-business.revolut.com/app-confirm',
  production: 'https://business.revolut.com/app-confirm',
}

export type RevolutScope = 'READ' | 'WRITE' | 'PAY' | 'READ_SENSITIVE_CARD_DATA'

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
}

/** The domain Revolut expects as `iss`: the redirect URI's host, no scheme, no path. */
export function issuerFromRedirectUri(redirectUri: string): string {
  return new URL(redirectUri).hostname
}

export function buildAuthorizeUrl(args: { environment: RevolutEnvironment; clientId: string; redirectUri: string; scopes?: RevolutScope[] }): string {
  const u = new URL(REVOLUT_CONSENT_BASE[args.environment])
  u.searchParams.set('client_id', args.clientId)
  u.searchParams.set('redirect_uri', args.redirectUri)
  u.searchParams.set('response_type', 'code')
  if (args.scopes && args.scopes.length > 0) u.searchParams.set('scope', args.scopes.join(','))
  return u.toString()
}

export function normalizePrivateKey(raw: string): string {
  const s = raw.trim()
  if (s.includes('-----BEGIN')) return s.replace(/\\n/g, '\n').trim()
  // Allow a base64-encoded PEM (handy for env vars on Vercel).
  return Buffer.from(s, 'base64').toString('utf8').trim()
}

export function buildClientAssertion(args: {
  clientId: string
  redirectUri: string
  privateKeyPem: string
  now?: Date
  ttlSeconds?: number
}): string {
  const now = Math.floor((args.now ?? new Date()).getTime() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: issuerFromRedirectUri(args.redirectUri),
    sub: args.clientId,
    aud: 'https://revolut.com',
    iat: now,
    exp: now + (args.ttlSeconds ?? 300),
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(args.privateKeyPem)
  return `${signingInput}.${b64url(signature)}`
}

interface TokenCall {
  environment: RevolutEnvironment
  clientId: string
  redirectUri: string
  privateKeyPem: string
  fetchImpl?: typeof fetch
}

export async function exchangeAuthorizationCode(args: TokenCall & { code: string }): Promise<TokenResponse> {
  return postToken(args, { grant_type: 'authorization_code', code: args.code })
}

export async function refreshAccessToken(args: TokenCall & { refreshToken: string }): Promise<TokenResponse> {
  return postToken(args, { grant_type: 'refresh_token', refresh_token: args.refreshToken })
}

async function postToken(args: TokenCall, grant: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({
    ...grant,
    client_id: args.clientId,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: buildClientAssertion({ clientId: args.clientId, redirectUri: args.redirectUri, privateKeyPem: args.privateKeyPem }),
  })
  const f = args.fetchImpl ?? fetch
  const res = await f(`${REVOLUT_API_BASE[args.environment]}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Revolut token request failed (${res.status}): ${redact(text)}`)
  }
  const json = JSON.parse(text) as TokenResponse
  if (!json.access_token || typeof json.expires_in !== 'number') {
    throw new Error('Revolut token response missing access_token/expires_in')
  }
  return json
}

/** Never let a token or code leak into logs through an error message. */
export function redact(s: string): string {
  return s.replace(/oa_(prod|sand)_[A-Za-z0-9_-]+/g, 'oa_$1_[redacted]').slice(0, 500)
}
