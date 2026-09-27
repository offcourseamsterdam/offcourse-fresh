import { describe, it, expect } from 'vitest'
import { buildHomeMarkdown } from './build-home-markdown'

describe('buildHomeMarkdown', () => {
  it('includes the brand tagline and boat facts', () => {
    const md = buildHomeMarkdown('en')
    expect(md).toContain('# Off Course Amsterdam')
    expect(md).toContain('*Your friend with a boat.*')
    expect(md).toContain('**Diana** — max 8 guests')
    expect(md).toContain('**Curaçao** — max 12 guests')
  })

  it('links onward using the given locale, and points to the full knowledge base', () => {
    const md = buildHomeMarkdown('nl')
    expect(md).toContain('(https://offcourseamsterdam.com/nl/cruises)')
    expect(md).toContain('(https://offcourseamsterdam.com/nl/blog)')
    expect(md).toContain('(https://offcourseamsterdam.com/llms-full.txt)')
  })
})
