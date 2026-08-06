import { describe, it, expect } from 'vitest'
import {
  sha256Hex,
  normalizeEmail,
  buildUserIdentifiers,
} from './user-identifiers'

// ── sha256Hex ───────────────────────────────────────────────────────────────

describe('sha256Hex', () => {
  it('matches the known empty-string SHA-256 vector', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('is deterministic, 64-char lowercase hex', () => {
    const a = sha256Hex('jannah@example.com')
    expect(a).toBe(sha256Hex('jannah@example.com'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── normalizeEmail ──────────────────────────────────────────────────────────

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Jannah@Example.COM ')).toBe('jannah@example.com')
  })

  it('strips dots and +suffix for gmail / googlemail', () => {
    expect(normalizeEmail('j.a.n.n.a.h+promo@gmail.com')).toBe('jannah@gmail.com')
    expect(normalizeEmail('j.smith@googlemail.com')).toBe('jsmith@googlemail.com')
  })

  it('keeps dots for non-gmail domains', () => {
    expect(normalizeEmail('first.last@outlook.com')).toBe('first.last@outlook.com')
  })

  it('returns null for non-emails', () => {
    expect(normalizeEmail('notanemail')).toBeNull()
    expect(normalizeEmail('@x.com')).toBeNull()
    expect(normalizeEmail('a@')).toBeNull()
  })
})

// normalizePhoneE164 now lives in src/lib/phone/normalize.ts (dependency-free,
// so it's importable from client code too) — see normalize.test.ts.

// ── buildUserIdentifiers ────────────────────────────────────────────────────

describe('buildUserIdentifiers', () => {
  it('builds hashed email + phone identifiers, all FIRST_PARTY', () => {
    const ids = buildUserIdentifiers({ email: 'Jannah@example.com', phone: '06 1234 5678' })
    expect(ids).toEqual([
      { userIdentifierSource: 'FIRST_PARTY', hashedEmail: sha256Hex('jannah@example.com') },
      { userIdentifierSource: 'FIRST_PARTY', hashedPhoneNumber: sha256Hex('+31612345678') },
    ])
  })

  it('includes only what is present', () => {
    expect(buildUserIdentifiers({ email: 'a@b.com' })).toHaveLength(1)
    expect(buildUserIdentifiers({ phone: '0612345678' })).toHaveLength(1)
    expect(buildUserIdentifiers({})).toEqual([])
    expect(buildUserIdentifiers({ email: 'bad', phone: '12' })).toEqual([])
  })
})
