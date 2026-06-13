import { describe, it, expect } from 'vitest'
import { replySimilarity } from './similarity'

describe('replySimilarity', () => {
  it('calls an identical reply a match (ratio 1)', () => {
    const r = replySimilarity('Yes, Saturday at 5pm works great!', 'Yes, Saturday at 5pm works great!')
    expect(r.label).toBe('match')
    expect(r.ratio).toBe(1)
  })

  it('treats a light edit (dropped exclamation, same content) as a match', () => {
    const r = replySimilarity(
      'Yes! Saturday at 5pm on the Diana works great for 4 guests.',
      'Yes, Saturday 5pm on the Diana works great for 4 guests.',
    )
    expect(r.label).toBe('match')
  })

  it('flags a meaningfully different reply', () => {
    const r = replySimilarity(
      'Sorry, we are fully booked on Saturday.',
      'Actually we just had a cancellation — Diana is free at 5pm, want it?',
    )
    expect(r.label).toBe('different')
    expect(r.ratio).toBeLessThan(0.3)
  })

  it('lands a partial rewrite in the minor band', () => {
    const r = replySimilarity(
      'The private cruise is 310 euros for 90 minutes on the Diana.',
      'The private Diana cruise starts at 310 euros, and includes blankets and a speaker.',
    )
    expect(r.label).toBe('minor')
  })

  it('two empty replies are a match (no divide-by-zero)', () => {
    expect(replySimilarity('', '')).toEqual({ ratio: 1, label: 'match' })
  })

  it('ignores stopwords and punctuation when comparing', () => {
    // Both reduce to the same meaningful tokens {on, water} once stopwords/punct drop.
    const r = replySimilarity('We are on the water!', 'on the water')
    expect(r.label).toBe('match')
  })
})
