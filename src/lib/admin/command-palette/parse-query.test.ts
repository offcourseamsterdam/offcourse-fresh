import { describe, it, expect } from 'vitest'
import { parseQuery } from './parse-query'

describe('parseQuery', () => {
  it('returns the whole trimmed string with no scope when there is no prefix', () => {
    expect(parseQuery('  diana  ')).toEqual({ text: 'diana', scope: null })
  })
  it('recognizes each single-letter prefix', () => {
    expect(parseQuery('b diana')).toEqual({ text: 'diana', scope: 'bookings' })
    expect(parseQuery('c refund')).toEqual({ text: 'refund', scope: 'chats' })
    expect(parseQuery('f viator')).toEqual({ text: 'viator', scope: 'finance' })
    expect(parseQuery('p acme')).toEqual({ text: 'acme', scope: 'partners' })
  })
  it('treats a bare one-letter query as a search term, not a dangling prefix', () => {
    expect(parseQuery('b')).toEqual({ text: 'b', scope: null })
  })
  it('is case-insensitive on the prefix but not on the remaining text', () => {
    expect(parseQuery('B Diana')).toEqual({ text: 'Diana', scope: 'bookings' })
  })
  it('ignores an unrecognized letter prefix', () => {
    expect(parseQuery('x diana')).toEqual({ text: 'x diana', scope: null })
  })
  it('handles empty and whitespace-only input', () => {
    expect(parseQuery('')).toEqual({ text: '', scope: null })
    expect(parseQuery('   ')).toEqual({ text: '', scope: null })
  })
  it('collapses "b " (prefix, no text after) to an empty scoped query', () => {
    expect(parseQuery('b ')).toEqual({ text: '', scope: 'bookings' })
  })
  it('only takes the first word as a candidate prefix, keeps the rest as text verbatim', () => {
    expect(parseQuery('b diana maria')).toEqual({ text: 'diana maria', scope: 'bookings' })
  })
})
