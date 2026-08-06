import { describe, it, expect } from 'vitest'
import { normalizePhoneE164 } from './normalize'

describe('normalizePhoneE164', () => {
  it('keeps an existing + prefix, stripping separators', () => {
    expect(normalizePhoneE164('+31 6 1234 5678')).toBe('+31612345678')
  })

  it('converts 00 / 0 / bare NL formats to E.164', () => {
    expect(normalizePhoneE164('0031612345678')).toBe('+31612345678')
    expect(normalizePhoneE164('06-12345678')).toBe('+31612345678')
    expect(normalizePhoneE164('31612345678')).toBe('+31612345678')
    expect(normalizePhoneE164('612345678')).toBe('+31612345678')
  })

  it('strips dashes and dots as well as spaces', () => {
    expect(normalizePhoneE164('+31.6.1234.5678')).toBe('+31612345678')
    expect(normalizePhoneE164('+31-6-1234-5678')).toBe('+31612345678')
  })

  it('returns null for empty / too-short input', () => {
    expect(normalizePhoneE164('')).toBeNull()
    expect(normalizePhoneE164('123')).toBeNull()
  })
})
