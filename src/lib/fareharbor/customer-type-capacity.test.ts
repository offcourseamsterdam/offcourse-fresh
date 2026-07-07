import { describe, it, expect } from 'vitest'
import { parseCapacityFromNote } from './customer-type-capacity'

describe('parseCapacityFromNote', () => {
  it('parses "Up to N people" (Diana\'s real note)', () => {
    expect(parseCapacityFromNote('Up to 8 people')).toBe(8)
  })

  it('parses "Up to N people" (Curaçao\'s real note)', () => {
    expect(parseCapacityFromNote('Up to 12 people')).toBe(12)
  })

  it('is case-insensitive', () => {
    expect(parseCapacityFromNote('UP TO 6 PEOPLE')).toBe(6)
  })

  it('returns null for an unrelated note (shared cruise age bracket)', () => {
    expect(parseCapacityFromNote('13+ years')).toBeNull()
  })

  it('returns null for null/undefined/empty input', () => {
    expect(parseCapacityFromNote(null)).toBeNull()
    expect(parseCapacityFromNote(undefined)).toBeNull()
    expect(parseCapacityFromNote('')).toBeNull()
  })
})
