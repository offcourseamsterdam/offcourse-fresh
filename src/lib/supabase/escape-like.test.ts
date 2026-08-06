import { describe, it, expect } from 'vitest'
import { escapeLikePattern } from './escape-like'

describe('escapeLikePattern', () => {
  it('leaves an ordinary name unchanged', () => {
    expect(escapeLikePattern('Susanne Hartmann')).toBe('Susanne Hartmann')
  })

  it('escapes a bare % so it cannot match every row', () => {
    expect(escapeLikePattern('%')).toBe('\\%')
  })

  it('escapes underscores, which otherwise match any single character', () => {
    expect(escapeLikePattern('sarah_m')).toBe('sarah\\_m')
  })

  it('escapes a literal backslash so it is not read as an escape character itself', () => {
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash')
  })

  it('escapes every metacharacter in a mixed string', () => {
    expect(escapeLikePattern('100%_off\\deal')).toBe('100\\%\\_off\\\\deal')
  })

  it('is a no-op on an empty string', () => {
    expect(escapeLikePattern('')).toBe('')
  })
})
