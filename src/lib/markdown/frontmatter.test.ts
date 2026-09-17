import { describe, it, expect } from 'vitest'
import { buildFrontmatter } from './frontmatter'

describe('buildFrontmatter', () => {
  it('wraps a delimited YAML block around the given fields', () => {
    const result = buildFrontmatter({ title: 'Sunset Cruise', description: 'Golden hour on the water' })
    expect(result).toBe(
      ['---', 'title: "Sunset Cruise"', 'description: "Golden hour on the water"', '---'].join('\n')
    )
  })

  it('omits keys with null, undefined, or empty-string values', () => {
    const result = buildFrontmatter({ title: 'Sunset Cruise', description: null, image: undefined, tagline: '' })
    expect(result).toBe(['---', 'title: "Sunset Cruise"', '---'].join('\n'))
  })

  it('preserves field order', () => {
    const result = buildFrontmatter({ b: '2', a: '1' })
    expect(result).toBe(['---', 'b: "2"', 'a: "1"', '---'].join('\n'))
  })

  it('escapes embedded double quotes', () => {
    const result = buildFrontmatter({ title: 'The "Best" Cruise' })
    expect(result).toBe(['---', 'title: "The \\"Best\\" Cruise"', '---'].join('\n'))
  })

  it('escapes embedded backslashes before quotes so escaping is unambiguous', () => {
    const result = buildFrontmatter({ title: 'C:\\boats' })
    expect(result).toBe(['---', 'title: "C:\\\\boats"', '---'].join('\n'))
  })

  it('collapses embedded newlines to spaces and trims the result', () => {
    const result = buildFrontmatter({ description: '  Line one\nLine two  \n' })
    expect(result).toBe(['---', 'description: "Line one Line two"', '---'].join('\n'))
  })

  it('returns just the delimiters when every field is empty', () => {
    expect(buildFrontmatter({})).toBe('---\n---')
  })
})
