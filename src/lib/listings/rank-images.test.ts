import { describe, it, expect } from 'vitest'
import { rankImagesForListing, type ImageForRanking } from './rank-images'

function img(id: string, tags: string[], extras: Partial<ImageForRanking> = {}): ImageForRanking {
  return { id, tags, ...extras }
}

describe('rankImagesForListing — basic scoring', () => {
  it('returns empty array when no images', () => {
    expect(rankImagesForListing([], ['couples'])).toEqual([])
  })

  it('returns empty array when no image has any matching tag', () => {
    const pool = [img('a', ['expats']), img('b', ['elderly'])]
    expect(rankImagesForListing(pool, ['couples'])).toEqual([])
  })

  it('ranks an audience match (+3) above a non-audience match (+1)', () => {
    const pool = [
      img('non-audience', ['sunset']),
      img('audience', ['couples']),
    ]
    const ranked = rankImagesForListing(pool, ['couples', 'sunset'])
    expect(ranked.map((i) => i.id)).toEqual(['audience', 'non-audience'])
  })

  it('sums matches across tags', () => {
    const pool = [
      img('one-match', ['couples']),                       // +3
      img('two-match', ['couples', 'sunset']),             // +3 +1 = 4
      img('three-match', ['couples', 'sunset', 'romantic']), // +3 +1 +1 = 5
    ]
    const ranked = rankImagesForListing(pool, ['couples', 'sunset', 'romantic'])
    expect(ranked.map((i) => i.id)).toEqual(['three-match', 'two-match', 'one-match'])
  })
})

describe('rankImagesForListing — confidence + usage_count modifiers', () => {
  it('breaks ties using confidence', () => {
    const pool = [
      img('low-conf', ['couples'], { confidence: 0.3 }),
      img('high-conf', ['couples'], { confidence: 0.9 }),
    ]
    const ranked = rankImagesForListing(pool, ['couples'])
    expect(ranked.map((i) => i.id)).toEqual(['high-conf', 'low-conf'])
  })

  it('subtracts a freshness penalty for already-used images', () => {
    // Both match audience (+3). Heavily used image gets -0.3 × 5 = -1.5.
    // Fresh: 3. Used: 1.5. Fresh wins.
    const pool = [
      img('fresh', ['couples'], { usage_count: 0 }),
      img('used', ['couples'], { usage_count: 5 }),
    ]
    const ranked = rankImagesForListing(pool, ['couples'])
    expect(ranked.map((i) => i.id)).toEqual(['fresh', 'used'])
  })

  it('a really strong tag match still beats a fresh weakly-matching image', () => {
    const pool = [
      img('weak-fresh', ['sunset'], { usage_count: 0 }),        // +1
      img('strong-used', ['couples'], { usage_count: 3 }),       // +3 -0.9 = 2.1
    ]
    const ranked = rankImagesForListing(pool, ['couples', 'sunset'])
    expect(ranked.map((i) => i.id)).toEqual(['strong-used', 'weak-fresh'])
  })
})

describe('rankImagesForListing — limit', () => {
  it('respects the default limit of 8', () => {
    const pool = Array.from({ length: 20 }, (_, i) => img(`img-${i}`, ['couples']))
    const ranked = rankImagesForListing(pool, ['couples'])
    expect(ranked).toHaveLength(8)
  })

  it('respects a custom limit', () => {
    const pool = Array.from({ length: 10 }, (_, i) => img(`img-${i}`, ['couples']))
    const ranked = rankImagesForListing(pool, ['couples'], { limit: 3 })
    expect(ranked).toHaveLength(3)
  })

  it('returns fewer than limit when pool is small', () => {
    const pool = [img('a', ['couples']), img('b', ['couples'])]
    const ranked = rankImagesForListing(pool, ['couples'], { limit: 8 })
    expect(ranked).toHaveLength(2)
  })
})

describe('rankImagesForListing — variety constraint', () => {
  it('caps audience-tag concentration at 60% by default (5 of 8)', () => {
    // 10 couples photos + 5 families photos. Listing tagged with couples + families.
    // Default cap: floor(8 × 0.6) = 4. So at most 4 couples in result.
    const pool = [
      ...Array.from({ length: 10 }, (_, i) =>
        img(`c-${i}`, ['couples'], { confidence: 0.9 })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        img(`f-${i}`, ['families'], { confidence: 0.9 })
      ),
    ]
    const ranked = rankImagesForListing(pool, ['couples', 'families'], { limit: 8 })
    const couplesCount = ranked.filter((i) => i.tags.includes('couples')).length
    const familiesCount = ranked.filter((i) => i.tags.includes('families')).length
    expect(couplesCount).toBeLessThanOrEqual(4)
    expect(familiesCount).toBeGreaterThan(0)
    expect(ranked).toHaveLength(8)
  })

  it('tops up from skipped images when variety leaves the limit unfilled', () => {
    // Only couples photos — variety constraint would cap at 4, but we need 8.
    // Implementation falls back to filling with skipped images.
    const pool = Array.from({ length: 12 }, (_, i) =>
      img(`c-${i}`, ['couples'], { confidence: 0.9 })
    )
    const ranked = rankImagesForListing(pool, ['couples'], { limit: 8 })
    expect(ranked).toHaveLength(8)
  })

  it('custom variety cap is respected', () => {
    const pool = [
      ...Array.from({ length: 5 }, (_, i) => img(`c-${i}`, ['couples'])),
      ...Array.from({ length: 5 }, (_, i) => img(`f-${i}`, ['families'])),
    ]
    // Cap of 0.5 × 4 = 2 per audience.
    const ranked = rankImagesForListing(pool, ['couples', 'families'], {
      limit: 4,
      audienceVarietyCap: 0.5,
    })
    const couplesCount = ranked.filter((i) => i.tags.includes('couples')).length
    expect(couplesCount).toBeLessThanOrEqual(2)
  })
})

describe('rankImagesForListing — determinism', () => {
  it('produces stable ordering when scores are tied (id-based tiebreaker)', () => {
    const pool = [img('z', ['couples']), img('a', ['couples']), img('m', ['couples'])]
    const ranked = rankImagesForListing(pool, ['couples'])
    expect(ranked.map((i) => i.id)).toEqual(['a', 'm', 'z'])
  })
})
