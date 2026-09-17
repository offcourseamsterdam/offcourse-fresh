import { describe, it, expect } from 'vitest'
import { escapeIlike, ilikePattern } from './ilike'

describe('escapeIlike', () => {
  it('leaves ordinary text unchanged', () => {
    expect(escapeIlike('Diana de Vries')).toBe('Diana de Vries')
  })
  it('strips commas — the PostgREST or() clause separator', () => {
    expect(escapeIlike('x,other.eq.1')).toBe('x other.eq.1')
  })
  it('strips parentheses — PostgREST logical grouping', () => {
    expect(escapeIlike('foo)or(bar')).toBe('foo or bar')
  })
  it('strips SQL LIKE wildcards % and _', () => {
    expect(escapeIlike('50%_off')).toBe('50 off')
  })
  it('collapses the whitespace left behind and trims', () => {
    expect(escapeIlike('  a,  ,b  ')).toBe('a b')
  })
  it('returns an empty string for input that is only special characters', () => {
    expect(escapeIlike(',(),%%,')).toBe('')
  })
})

describe('ilikePattern', () => {
  it('wraps the escaped term in % wildcards', () => {
    expect(ilikePattern('diana')).toBe('%diana%')
  })
  it('escapes before wrapping, so a stray % in input cannot widen the pattern', () => {
    expect(ilikePattern('50%')).toBe('%50%')
  })
  it('returns null when the term is only special characters — %% would otherwise match every row', () => {
    expect(ilikePattern(',,')).toBeNull()
    expect(ilikePattern('((')).toBeNull()
    expect(ilikePattern('%%')).toBeNull()
  })
  it('returns null for an empty or whitespace-only term', () => {
    expect(ilikePattern('')).toBeNull()
    expect(ilikePattern('   ')).toBeNull()
  })
})
