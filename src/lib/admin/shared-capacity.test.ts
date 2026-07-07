import { describe, it, expect } from 'vitest'
import { guessBoatFromCapacity } from './shared-capacity'

describe('guessBoatFromCapacity', () => {
  it('guesses Diana for an 8-seat baseline', () => {
    expect(guessBoatFromCapacity(8)).toBe('Diana')
  })

  it('guesses Curaçao for a 12-seat baseline', () => {
    expect(guessBoatFromCapacity(12)).toBe('Curaçao')
  })

  it('returns null for a baseline matching neither boat (e.g. a listing-configured cap)', () => {
    expect(guessBoatFromCapacity(6)).toBeNull()
  })

  it('returns null for zero', () => {
    expect(guessBoatFromCapacity(0)).toBeNull()
  })
})
