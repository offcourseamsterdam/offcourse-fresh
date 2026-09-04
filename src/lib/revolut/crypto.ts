/**
 * At-rest encryption for Revolut secrets stored in the database (refresh token,
 * access token, webhook signing secret). AES-256-GCM with a key from
 * REVOLUT_TOKEN_KEY (32 random bytes, base64). Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Stored format: `v1.<iv>.<authTag>.<ciphertext>` (all base64url). A different
 * key, or a tampered field, fails to decrypt instead of returning garbage.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'
const VERSION = 'v1'

export function getTokenKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.REVOLUT_TOKEN_KEY
  if (!raw) throw new Error('REVOLUT_TOKEN_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('REVOLUT_TOKEN_KEY must decode to exactly 32 bytes')
  return key
}

export function encryptSecret(plaintext: string, key: Buffer = getTokenKey()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, b64url(iv), b64url(tag), b64url(ct)].join('.')
}

export function decryptSecret(stored: string, key: Buffer = getTokenKey()): string {
  const parts = stored.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unrecognised encrypted secret format')
  const [, iv, tag, ct] = parts
  const decipher = createDecipheriv(ALG, key, fromB64url(iv))
  decipher.setAuthTag(fromB64url(tag))
  return Buffer.concat([decipher.update(fromB64url(ct)), decipher.final()]).toString('utf8')
}

export function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}
