import { describe, it, expect } from 'vitest'
import { generateMoveToken, isValidMoveToken, moveResponseUrl } from './move-token'

describe('move token', () => {
  it('roundtrips: a generated token validates for its own proposal id', () => {
    const token = generateMoveToken('proposal-1')
    expect(isValidMoveToken('proposal-1', token)).toBe(true)
  })

  it('a token never validates for a DIFFERENT proposal (per-link isolation)', () => {
    const token = generateMoveToken('proposal-1')
    expect(isValidMoveToken('proposal-2', token)).toBe(false)
  })

  it('rejects garbage and empty tokens without throwing', () => {
    expect(isValidMoveToken('proposal-1', 'nonsense')).toBe(false)
    expect(isValidMoveToken('proposal-1', '')).toBe(false)
  })

  it('builds the public URL the guest taps', () => {
    const url = moveResponseUrl('https://offcourseamsterdam.com', 'abc')
    expect(url).toBe(`https://offcourseamsterdam.com/en/move/abc/${generateMoveToken('abc')}`)
  })
})
