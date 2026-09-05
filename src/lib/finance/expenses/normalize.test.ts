import { describe, it, expect } from 'vitest'
import { amountsClose, amountTolerance, daysFromTo, nameSimilarity, normalizeName, normalizeReference, referenceContains } from './normalize'

describe('normalizeName', () => {
  it('drops legal forms, punctuation and statement noise', () => {
    expect(normalizeName('BOL.COM B.V.')).toBe('bol')
    expect(normalizeName('Bol.com')).toBe('bol')
    expect(normalizeName('WWW.SCHEPENVERZEKERING.NL')).toBe('schepenverzekering')
    expect(normalizeName('Jachthaven Amsterdam VOF')).toBe('jachthaven amsterdam')
  })
  it('is safe on null/empty', () => {
    expect(normalizeName(null)).toBe('')
    expect(normalizeName('   ')).toBe('')
  })
})

describe('nameSimilarity', () => {
  it('the PRD pair: statement "BOL.COM BV" and invoice "Bol.com" are the same supplier', () => {
    expect(nameSimilarity('BOL.COM BV', 'Bol.com')).toBe(1)
  })
  it('containment (a statement with a city appended) scores high but below exact', () => {
    expect(nameSimilarity('Jachthaven Amsterdam Noord', 'Jachthaven Amsterdam')).toBe(0.9)
  })
  it('partial brand overlap scores something, never a full match', () => {
    const s = nameSimilarity('Albert Heijn 1234', 'Albert Heijn to go')
    expect(s).toBeGreaterThan(0.3)
    expect(s).toBeLessThan(0.9)
  })
  it('unrelated names score zero', () => {
    expect(nameSimilarity('Bol.com', 'Coolblue')).toBe(0)
    expect(nameSimilarity('', 'Coolblue')).toBe(0)
  })
})

describe('amountsClose', () => {
  it('exact', () => {
    expect(amountsClose(12100, 12100)).toEqual({ exact: true, within: true, diffCents: 0 })
  })
  it('within €1 on a small amount (card rounding)', () => {
    expect(amountsClose(2420, 2500)).toMatchObject({ exact: false, within: true })
    expect(amountsClose(2420, 2521)).toMatchObject({ within: false })
  })
  it('within 1% on a large amount', () => {
    expect(amountTolerance(100_000)).toBe(1000)
    expect(amountsClose(100_000, 100_900)).toMatchObject({ within: true })
    expect(amountsClose(100_000, 101_100)).toMatchObject({ within: false })
  })
})

describe('daysFromTo', () => {
  it('handles plain dates and ISO datetimes alike', () => {
    expect(daysFromTo('2026-09-05', '2026-09-07')).toBe(2)
    expect(daysFromTo('2026-09-07T10:00:00.000Z', '2026-09-05')).toBe(-2)
  })
})

describe('references', () => {
  it('normalises case, spaces and hashes', () => {
    expect(normalizeReference('# INV-2026 12345')).toBe('INV202612345')
  })
  it('finds an order number inside a bank description regardless of formatting', () => {
    expect(referenceContains('BOL.COM order 12345 kenmerk', '#12345')).toBe(true)
    expect(referenceContains('Betaling INV-2026-12345', 'inv 2026 12345')).toBe(true)
  })
  it('never treats a tiny number as evidence', () => {
    expect(referenceContains('order 12 confirmed', '12')).toBe(false)
    expect(referenceContains('anything', null)).toBe(false)
  })
})
