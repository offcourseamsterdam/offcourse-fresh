import { describe, it, expect } from 'vitest'
import {
  sectionRootStyle,
  roleColor,
  SECTION_DEFS,
  SECTION_DEF_BY_KEY,
  type SectionStyle,
} from './section-styles'

describe('sectionRootStyle', () => {
  it('returns an empty object when there is no custom style (coded defaults apply)', () => {
    expect(sectionRootStyle(undefined)).toEqual({})
    expect(sectionRootStyle(null)).toEqual({})
    expect(sectionRootStyle({ background: null, text_colors: {} })).toEqual({})
  })

  it('applies a custom background (solid colour + webp image, cover/center)', () => {
    const style: SectionStyle = {
      background: { webp: 'https://x/t.webp', avif: 'https://x/t.avif', color: '#31308a' },
      text_colors: {},
    }
    expect(sectionRootStyle(style)).toEqual({
      backgroundColor: '#31308a',
      backgroundImage: 'url("https://x/t.webp")',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    })
  })

  it('sets a --sec-* variable only for each provided text colour', () => {
    const css = sectionRootStyle({ background: null, text_colors: { h2: '#990000', body: '#1f2937' } }) as Record<string, string>
    expect(css['--sec-h2']).toBe('#990000')
    expect(css['--sec-body']).toBe('#1f2937')
    expect(css['--sec-h3']).toBeUndefined()
  })

  it('combines background and text colours', () => {
    const css = sectionRootStyle({
      background: { webp: 'w', avif: 'a', color: '#000000' },
      text_colors: { h3: '#343499' },
    }) as Record<string, string>
    expect(css.backgroundColor).toBe('#000000')
    expect(css['--sec-h3']).toBe('#343499')
  })
})

describe('roleColor', () => {
  it('reads the section variable with the coded default as fallback', () => {
    expect(roleColor('h2', '#990000')).toBe('var(--sec-h2, #990000)')
    expect(roleColor('body', '#1f2937')).toBe('var(--sec-body, #1f2937)')
  })
})

describe('SECTION_DEFS', () => {
  it('covers all seven homepage sections with unique keys', () => {
    const keys = SECTION_DEFS.map(d => d.key)
    expect(keys).toEqual(['hero', 'featured_cruises', 'reviews', 'priorities', 'fleet', 'location', 'footer'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('only exposes h2/h3/body roles, each with a valid hex default', () => {
    for (const def of SECTION_DEFS) {
      for (const role of def.roles) {
        expect(['h2', 'h3', 'body']).toContain(role.key)
        expect(role.default).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('indexes every def by key', () => {
    expect(SECTION_DEF_BY_KEY.hero.label).toBe('Hero')
    expect(SECTION_DEF_BY_KEY.footer.roles).toHaveLength(1)
  })
})
