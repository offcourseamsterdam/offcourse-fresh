import { describe, it, expect } from 'vitest'
import { htmlToMarkdown } from './html-to-markdown'

describe('htmlToMarkdown', () => {
  it('converts paragraphs and double line breaks to blank-line-separated text', () => {
    const html = '<p>First bit.<br><br>Second bit.</p>'
    const md = htmlToMarkdown(html)
    expect(md).not.toContain('<p>')
    expect(md).not.toContain('<br>')
    expect(md).toContain('First bit.')
    expect(md).toContain('Second bit.')
  })

  it('decodes &nbsp; entities into plain spaces', () => {
    const md = htmlToMarkdown('<p>No fixed script,&nbsp;no tourist traps.</p>')
    expect(md).not.toContain('&nbsp;')
    expect(md).toContain('no tourist traps')
  })

  it('converts bold and italic tags to markdown emphasis', () => {
    const md = htmlToMarkdown('<p>This is <strong>bold</strong> and <em>italic</em>.</p>')
    expect(md).toContain('**bold**')
    expect(md).toContain('_italic_')
  })

  it('trims surrounding whitespace', () => {
    expect(htmlToMarkdown('  <p>Hello</p>  ')).toBe('Hello')
  })
})
