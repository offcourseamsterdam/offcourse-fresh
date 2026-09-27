import { describe, it, expect } from 'vitest'
import { buildBlogMarkdown } from './build-blog-markdown'

const BASE = {
  title: 'The Jordaan: A Local’s Guide',
  description: 'Hidden gems in Amsterdam\'s most charming neighbourhood.',
  contentHtml: '<p>The Jordaan started as a <strong>workers’ district</strong>.</p><h2>Getting there</h2><ul><li>By bike</li><li>On foot</li></ul>',
  image: 'https://example.com/jordaan.jpg',
  date: '2026-06-01T10:00:00',
  url: 'https://offcourseamsterdam.com/en/blog/the-jordaan',
}

describe('buildBlogMarkdown', () => {
  it('includes frontmatter with title, description, image, and date', () => {
    const md = buildBlogMarkdown(BASE)
    expect(md).toContain('title: "The Jordaan')
    expect(md).toContain('description: "Hidden gems in Amsterdam')
    expect(md).toContain('image: "https://example.com/jordaan.jpg"')
    expect(md).toContain('date: "2026-06-01T10:00:00"')
  })

  it('converts the HTML body to markdown', () => {
    const md = buildBlogMarkdown(BASE)
    expect(md).toContain('**workers')
    expect(md).toContain('## Getting there')
    expect(md).toContain('-   By bike')
    expect(md).toContain('-   On foot')
  })

  it('adds an H1 heading and a link back to the canonical URL', () => {
    const md = buildBlogMarkdown(BASE)
    expect(md).toContain('# The Jordaan')
    expect(md).toContain('[Read on the website](https://offcourseamsterdam.com/en/blog/the-jordaan)')
  })

  it('omits the description frontmatter field when empty', () => {
    const md = buildBlogMarkdown({ ...BASE, description: '' })
    expect(md).not.toContain('description:')
  })
})
