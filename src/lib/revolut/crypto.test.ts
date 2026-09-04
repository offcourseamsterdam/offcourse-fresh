import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret, getTokenKey, b64url, fromB64url } from './crypto'

const KEY = randomBytes(32)

describe('revolut/crypto', () => {
  it('round-trips a secret', () => {
    const s = 'oa_prod_hQacSGnwx-luIfj3dlVByrytVV9rWAnyHkpJTwG_Tr8'
    const enc = encryptSecret(s, KEY)
    expect(enc.startsWith('v1.')).toBe(true)
    expect(enc).not.toContain(s)
    expect(decryptSecret(enc, KEY)).toBe(s)
  })

  it('uses a fresh IV each time (same plaintext → different ciphertext)', () => {
    expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY))
  })

  it('fails with the wrong key or a tampered ciphertext instead of returning garbage', () => {
    const enc = encryptSecret('secret', KEY)
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow()
    const parts = enc.split('.')
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA')
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow()
    expect(() => decryptSecret('nonsense', KEY)).toThrow(/format/)
  })

  it('getTokenKey validates the env var', () => {
    expect(() => getTokenKey({})).toThrow(/not set/)
    expect(() => getTokenKey({ REVOLUT_TOKEN_KEY: Buffer.from('short').toString('base64') })).toThrow(/32 bytes/)
    expect(getTokenKey({ REVOLUT_TOKEN_KEY: KEY.toString('base64') }).equals(KEY)).toBe(true)
  })

  it('base64url helpers round-trip without padding characters', () => {
    const buf = randomBytes(37)
    const s = b64url(buf)
    expect(s).not.toMatch(/[=+/]/)
    expect(fromB64url(s).equals(buf)).toBe(true)
  })
})
