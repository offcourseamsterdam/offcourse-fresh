import { describe, it, expect } from 'vitest'
import { cleanTagId } from './tag-id'

describe('cleanTagId', () => {
  it('strips a trailing newline (the prod bug: AW-…\\n broke the inline gtag script)', () => {
    expect(cleanTagId('AW-18154563714\n')).toBe('AW-18154563714')
  })

  it('strips surrounding whitespace and other line endings', () => {
    expect(cleanTagId('  AW-18154563714  ')).toBe('AW-18154563714')
    expect(cleanTagId('AW-18154563714\r\n')).toBe('AW-18154563714')
  })

  it('passes a clean id through unchanged', () => {
    expect(cleanTagId('AW-18154563714')).toBe('AW-18154563714')
  })

  it('returns null for missing or blank values', () => {
    expect(cleanTagId(undefined)).toBeNull()
    expect(cleanTagId(null)).toBeNull()
    expect(cleanTagId('')).toBeNull()
    expect(cleanTagId('   \n')).toBeNull()
  })
})
