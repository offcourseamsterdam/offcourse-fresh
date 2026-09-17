import { describe, it, expect } from 'vitest'
import {
  fieldMatchQuality,
  matchQuality,
  MATCH_NONE,
  MATCH_SUBSTRING,
  MATCH_WORD_START,
  MATCH_EXACT,
} from './match'

describe('fieldMatchQuality', () => {
  it('scores an exact full-field match highest', () => {
    expect(fieldMatchQuality('planning', 'Planning')).toBe(MATCH_EXACT)
  })
  it('scores an exact single-word match within a longer field as exact', () => {
    expect(fieldMatchQuality('diana', 'Diana de Vries')).toBe(MATCH_EXACT)
  })
  it('scores a word-start match lower than exact', () => {
    expect(fieldMatchQuality('dia', 'Diana de Vries')).toBe(MATCH_WORD_START)
  })
  it('scores a mid-word substring match lower than word-start', () => {
    expect(fieldMatchQuality('iana', 'Diana de Vries')).toBe(MATCH_SUBSTRING)
  })
  it('scores no match as none', () => {
    expect(fieldMatchQuality('viator', 'Diana de Vries')).toBe(MATCH_NONE)
  })
  it('is accent-insensitive both ways', () => {
    expect(fieldMatchQuality('curacao', 'Private Cruise on Curaçao')).toBe(MATCH_EXACT)
    expect(fieldMatchQuality('Curaçao', 'curacao tour')).toBe(MATCH_EXACT)
    expect(fieldMatchQuality('cura', 'Private Cruise on Curaçao')).toBe(MATCH_WORD_START)
  })
  it('is case-insensitive, and matches a whole word inside the field exactly', () => {
    expect(fieldMatchQuality('VIATOR', 'viator batch #4')).toBe(MATCH_EXACT)
  })
  it('treats a null/undefined field as no match, not a throw', () => {
    expect(fieldMatchQuality('x', null)).toBe(MATCH_NONE)
    expect(fieldMatchQuality('x', undefined)).toBe(MATCH_NONE)
  })
  it('treats an empty query as no match', () => {
    expect(fieldMatchQuality('', 'anything')).toBe(MATCH_NONE)
  })
})

describe('matchQuality', () => {
  it('single-word query: best quality across all fields', () => {
    expect(matchQuality('diana', ['Boat details', 'Diana de Vries'])).toBe(MATCH_EXACT)
  })
  it('multi-word query: requires every word to match SOME field (each word here matches a whole word exactly)', () => {
    expect(matchQuality('viator march', ['Viator batch', 'March 2026 payout'])).toBe(MATCH_EXACT)
  })
  it('multi-word query: the weakest per-word quality wins when qualities differ', () => {
    expect(matchQuality('viator mar', ['Viator batch', 'March 2026 payout'])).toBe(MATCH_WORD_START)
  })
  it('multi-word query fails entirely if any single word matches nothing', () => {
    expect(matchQuality('viator zzzznotreal', ['Viator batch', 'March 2026 payout'])).toBe(MATCH_NONE)
  })
  it('multi-word score is the weakest per-word match, not the best', () => {
    // "diana" is exact against field 2; "de" is only a substring hit inside "Vries" -> none actually,
    // so use a case where both hit but at different qualities.
    expect(matchQuality('diana vries', ['irrelevant', 'Diana de Vries'])).toBe(MATCH_EXACT)
    expect(matchQuality('dia vries', ['irrelevant', 'Diana de Vries'])).toBe(MATCH_WORD_START)
  })
  it('empty query never matches', () => {
    expect(matchQuality('', ['anything'])).toBe(MATCH_NONE)
    expect(matchQuality('   ', ['anything'])).toBe(MATCH_NONE)
  })
  it('ignores null/undefined fields mixed into the list', () => {
    expect(matchQuality('diana', [null, undefined, 'Diana'])).toBe(MATCH_EXACT)
  })
})
