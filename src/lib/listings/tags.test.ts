import { describe, it, expect } from 'vitest'
import {
  TAG_CATEGORIES,
  ALL_TAGS,
  isValidTag,
  getTagCategory,
  tagsByCategory,
  TagSchema,
  TagArraySchema,
} from './tags'

describe('tag taxonomy', () => {
  it('exposes all 7 categories', () => {
    expect(Object.keys(TAG_CATEGORIES).sort()).toEqual(
      ['audience', 'booking', 'boat', 'mood', 'package', 'setting', 'time'].sort()
    )
  })

  it('contains no duplicate tags across categories', () => {
    const seen = new Set<string>()
    for (const tags of Object.values(TAG_CATEGORIES)) {
      for (const t of tags) {
        expect(seen.has(t), `duplicate tag: ${t}`).toBe(false)
        seen.add(t)
      }
    }
  })

  it('ALL_TAGS is the flat union of every category', () => {
    const expected = Object.values(TAG_CATEGORIES).flat().sort()
    expect([...ALL_TAGS].sort()).toEqual(expected)
  })

  it('includes the four audience tags Beer specified', () => {
    expect(TAG_CATEGORIES.audience).toEqual(['couples', 'families', 'elderly', 'expats'])
  })
})

describe('isValidTag', () => {
  it('accepts known tags', () => {
    expect(isValidTag('couples')).toBe(true)
    expect(isValidTag('sunset')).toBe(true)
    expect(isValidTag('champagne-breakfast')).toBe(true)
  })

  it('rejects unknown strings', () => {
    expect(isValidTag('honeymoon')).toBe(false)
    expect(isValidTag('')).toBe(false)
    expect(isValidTag('couples ')).toBe(false) // trailing space
  })
})

describe('getTagCategory', () => {
  it.each([
    ['couples', 'audience'],
    ['sunset', 'time'],
    ['jordaan', 'setting'],
    ['romantic', 'mood'],
    ['diana', 'boat'],
    ['private', 'booking'],
    ['wedding', 'package'],
  ])('maps %s → %s', (tag, category) => {
    expect(getTagCategory(tag as never)).toBe(category)
  })
})

describe('tagsByCategory', () => {
  it('groups a mixed tag set into category buckets', () => {
    const result = tagsByCategory(['couples', 'sunset', 'diana', 'romantic'])
    expect(result.audience).toEqual(['couples'])
    expect(result.time).toEqual(['sunset'])
    expect(result.boat).toEqual(['diana'])
    expect(result.mood).toEqual(['romantic'])
    expect(result.setting).toEqual([])
    expect(result.booking).toEqual([])
    expect(result.package).toEqual([])
  })

  it('returns empty buckets for empty input', () => {
    const result = tagsByCategory([])
    for (const cat of Object.values(result)) {
      expect(cat).toEqual([])
    }
  })
})

describe('TagSchema (Zod)', () => {
  it('parses valid tags', () => {
    expect(TagSchema.parse('couples')).toBe('couples')
  })

  it('throws on invalid tags', () => {
    expect(() => TagSchema.parse('honeymoon')).toThrow()
  })

  it('TagArraySchema validates arrays', () => {
    expect(TagArraySchema.parse(['couples', 'sunset'])).toEqual(['couples', 'sunset'])
    expect(() => TagArraySchema.parse(['couples', 'unknown'])).toThrow()
  })
})
