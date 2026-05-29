import { describe, it, expect } from 'vitest'
import { pickClickId, toClickType } from './click-ids'

function fromObject(params: Record<string, string>) {
  return (key: string) => params[key] ?? null
}

describe('pickClickId', () => {
  it('returns gclid when present', () => {
    expect(pickClickId(fromObject({ gclid: 'abc' }))).toEqual({ value: 'abc', type: 'gclid' })
  })

  it('returns wbraid / gbraid when there is no gclid', () => {
    expect(pickClickId(fromObject({ wbraid: 'w1' }))).toEqual({ value: 'w1', type: 'wbraid' })
    expect(pickClickId(fromObject({ gbraid: 'g1' }))).toEqual({ value: 'g1', type: 'gbraid' })
  })

  it('prefers gclid over the iOS ids when several are present', () => {
    expect(pickClickId(fromObject({ gbraid: 'g1', wbraid: 'w1', gclid: 'abc' })))
      .toEqual({ value: 'abc', type: 'gclid' })
    // wbraid beats gbraid
    expect(pickClickId(fromObject({ gbraid: 'g1', wbraid: 'w1' })))
      .toEqual({ value: 'w1', type: 'wbraid' })
  })

  it('returns null when none are present', () => {
    expect(pickClickId(fromObject({ utm_source: 'google' }))).toBeNull()
  })
})

describe('toClickType', () => {
  it('passes through known types', () => {
    expect(toClickType('gclid')).toBe('gclid')
    expect(toClickType('wbraid')).toBe('wbraid')
    expect(toClickType('gbraid')).toBe('gbraid')
  })

  it('defaults unknown / missing to gclid', () => {
    expect(toClickType(null)).toBe('gclid')
    expect(toClickType('')).toBe('gclid')
    expect(toClickType('nonsense')).toBe('gclid')
  })
})
