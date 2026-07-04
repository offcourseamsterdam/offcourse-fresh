import { describe, it, expect } from 'vitest'
import { deriveOperationalProfile } from './profile'

describe('deriveOperationalProfile', () => {
  it('shared cruises are flexible: time change, merge, and boat swap all allowed', () => {
    const profile = deriveOperationalProfile('shared')
    expect(profile).toEqual({
      kind: 'flexible',
      allowTimeChange: true,
      allowMerge: true,
      allowBoatSwap: true,
    })
  })

  it('private cruises are protected from merging but CAN be time/boat moved (Beer 2026-07-04)', () => {
    const profile = deriveOperationalProfile('private')
    expect(profile).toEqual({
      kind: 'protected',
      allowTimeChange: true,
      allowMerge: false,
      allowBoatSwap: true,
    })
  })

  it.each([null, undefined, '', 'unknown_category'])('defaults %s to protected (safest)', category => {
    expect(deriveOperationalProfile(category).kind).toBe('protected')
  })
})
