import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface RevolutTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
}

let cachedAccessToken: {
  token: string
  expiresAt: number
} | null = null

function base64UrlEncode(str: string | Buffer): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/**
 * Reads the Revolut private key from file or environment variable.
 */
export function getRevolutPrivateKey(): string | null {
  if (process.env.REVOLUT_PRIVATE_KEY) {
    let key = process.env.REVOLUT_PRIVATE_KEY
    if (key.includes('\\n')) key = key.replace(/\\n/g, '\n')
    return key
  }

  // Fallback to local certs file
  const localKeyPath = path.join(process.cwd(), 'certs', 'revolut', 'private.key')
  if (fs.existsSync(localKeyPath)) {
    return fs.readFileSync(localKeyPath, 'utf8')
  }

  return null
}

/**
 * Reads the Revolut public certificate from file.
 */
export function getRevolutPublicCert(): string | null {
  const localCertPath = path.join(process.cwd(), 'certs', 'revolut', 'public.cer')
  if (fs.existsSync(localCertPath)) {
    return fs.readFileSync(localCertPath, 'utf8')
  }
  return null
}

/**
 * Generates a signed JWT client assertion for Revolut Business API OAuth.
 */
export function generateClientAssertion(
  clientId: string,
  privateKeyPem: string,
  algorithm: 'RS256' | 'PS256' = 'RS256'
): string {
  const header = {
    alg: algorithm,
    typ: 'JWT',
  }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: clientId,
    sub: clientId,
    aud: 'https://revolut.com',
    iat: now,
    exp: now + 120, // 2 minutes validity
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const message = `${encodedHeader}.${encodedPayload}`

  const signer = crypto.createSign('RSA-SHA256')
  signer.update(message)

  let signatureBase64 = ''
  if (algorithm === 'PS256') {
    signatureBase64 = signer.sign(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      },
      'base64'
    )
  } else {
    signatureBase64 = signer.sign(privateKeyPem, 'base64')
  }

  const signature = signatureBase64
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${message}.${signature}`
}

/**
 * Exchange an OAuth authorization code for access_token and refresh_token.
 */
export async function exchangeAuthCode(params: {
  code: string
  clientId: string
  redirectUri: string
  privateKeyPem: string
  isSandbox?: boolean
}): Promise<RevolutTokenResponse> {
  const { code, clientId, redirectUri, privateKeyPem, isSandbox = false } = params
  const clientAssertion = generateClientAssertion(clientId, privateKeyPem)
  const baseUrl = isSandbox ? 'https://sandbox-b2b.revolut.com/api/1.0' : 'https://b2b.revolut.com/api/1.0'

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  })

  const res = await fetch(`${baseUrl}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Revolut auth error (${res.status}): ${errText || res.statusText}`)
  }

  const data: RevolutTokenResponse = await res.json()
  if (data.access_token) {
    cachedAccessToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    }
  }
  return data
}

/**
 * Use a refresh_token to obtain a new access_token.
 */
export async function refreshAccessToken(params: {
  refreshToken: string
  clientId: string
  privateKeyPem: string
  isSandbox?: boolean
}): Promise<RevolutTokenResponse> {
  const { refreshToken, clientId, privateKeyPem, isSandbox = false } = params
  const clientAssertion = generateClientAssertion(clientId, privateKeyPem)
  const baseUrl = isSandbox ? 'https://sandbox-b2b.revolut.com/api/1.0' : 'https://b2b.revolut.com/api/1.0'

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  })

  const res = await fetch(`${baseUrl}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Revolut token refresh error (${res.status}): ${errText || res.statusText}`)
  }

  const data: RevolutTokenResponse = await res.json()
  if (data.access_token) {
    cachedAccessToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    }
  }
  return data
}

/**
 * Returns a valid access token for Revolut Business API requests.
 * Automatically refreshes the token if expired.
 */
export async function getValidRevolutAccessToken(): Promise<string | null> {
  // 1. Static API Key override (from .env or sandbox)
  if (process.env.REVOLUT_BUSINESS_API_KEY && process.env.REVOLUT_BUSINESS_API_KEY.trim().length > 0) {
    return process.env.REVOLUT_BUSINESS_API_KEY.trim()
  }

  // 2. Active memory cached token
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token
  }

  // 3. OAuth with refresh token
  const clientId = process.env.REVOLUT_CLIENT_ID
  const refreshToken = process.env.REVOLUT_REFRESH_TOKEN
  const privateKey = getRevolutPrivateKey()

  if (clientId && refreshToken && privateKey) {
    try {
      const refreshed = await refreshAccessToken({
        clientId,
        refreshToken,
        privateKeyPem: privateKey,
      })
      return refreshed.access_token
    } catch (err) {
      console.error('[revolut-auth] Failed to refresh Revolut access token:', err)
    }
  }

  return null
}
