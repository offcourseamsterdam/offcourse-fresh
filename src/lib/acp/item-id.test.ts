import { describe, it, expect } from 'vitest'
import { encodeItemId, decodeItemId } from './item-id'

describe('encodeItemId / decodeItemId', () => {
  it('round-trips a well-formed item', () => {
    const item = { slug: 'book-curacao-boat-tour-amsterdam', date: '2026-07-04', availPk: 2125892280, customerTypeRatePk: 9030501784 }
    expect(decodeItemId(encodeItemId(item))).toEqual(item)
  })

  it('rejects an id with the wrong number of parts', () => {
    expect(decodeItemId('slug|2026-07-04|123')).toBeNull()
    expect(decodeItemId('slug|2026-07-04|123|1|extra')).toBeNull()
  })

  it('rejects a malformed date', () => {
    expect(decodeItemId('slug|07-04-2026|123|1')).toBeNull()
  })

  it('rejects a non-numeric or non-positive availPk', () => {
    expect(decodeItemId('slug|2026-07-04|abc|1')).toBeNull()
    expect(decodeItemId('slug|2026-07-04|0|1')).toBeNull()
    expect(decodeItemId('slug|2026-07-04|-5|1')).toBeNull()
  })

  it('rejects a non-numeric or non-positive customer type rate pk', () => {
    expect(decodeItemId('slug|2026-07-04|123|abc')).toBeNull()
    expect(decodeItemId('slug|2026-07-04|123|0')).toBeNull()
    expect(decodeItemId('slug|2026-07-04|123|-5')).toBeNull()
  })

  it('rejects an empty slug', () => {
    expect(decodeItemId('|2026-07-04|123|1')).toBeNull()
  })

  it('rejects garbage input', () => {
    expect(decodeItemId('not-an-item-id')).toBeNull()
    expect(decodeItemId('')).toBeNull()
  })
})
