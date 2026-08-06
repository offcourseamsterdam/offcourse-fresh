// @vitest-environment jsdom
//
// DOMPurify needs a real DOM to sanitize against (it throws under plain
// Node) — this file overrides the project's default 'node' vitest
// environment for exactly that reason.
import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml } from './sanitize-html'

describe('sanitizeEmailHtml', () => {
  it('strips <script> tags entirely', () => {
    const result = sanitizeEmailHtml('<p>Hi</p><script>alert(1)</script>')
    expect(result).not.toContain('<script')
    expect(result).not.toContain('alert')
    expect(result).toContain('Hi')
  })

  it('strips inline event handlers', () => {
    const result = sanitizeEmailHtml('<img src="data:image/png;base64,abc" onerror="alert(1)">')
    expect(result).not.toContain('onerror')
  })

  it('strips <style> tags (they could leak styling outside this one message)', () => {
    const result = sanitizeEmailHtml('<style>body { display: none }</style><p>Hi</p>')
    expect(result).not.toContain('<style')
    expect(result).not.toContain('display: none')
    expect(result).toContain('Hi')
  })

  it('keeps inline style="" attributes — this is how an email\'s own colors and formatting survive', () => {
    const result = sanitizeEmailHtml('<p style="color: red; font-weight: bold;">Hello</p>')
    expect(result).toContain('style=')
    expect(result).toContain('color')
  })

  it('drops a remote <img> src — the classic email tracking-pixel pattern', () => {
    const result = sanitizeEmailHtml('<img src="https://tracker.example.com/pixel.gif?id=abc123">')
    expect(result).not.toContain('tracker.example.com')
  })

  it('keeps an embedded data: URI image — no network request, no tracking risk', () => {
    const result = sanitizeEmailHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo">')
    expect(result).toContain('data:image/png;base64,iVBORw0KGgo=')
  })

  it('forces target="_blank" and rel="noopener noreferrer" on links', () => {
    const result = sanitizeEmailHtml('<a href="https://fareharbor.com">View booking</a>')
    expect(result).toContain('target="_blank"')
    expect(result).toContain('rel="noopener noreferrer"')
  })

  it('strips iframes, forms, and other embedding/interactive tags', () => {
    const result = sanitizeEmailHtml(
      '<iframe src="https://evil.example.com"></iframe><form action="https://evil.example.com"><input type="text"></form><object data="x"></object>',
    )
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('<form')
    expect(result).not.toContain('<input')
    expect(result).not.toContain('<object')
  })

  it('preserves plain formatting (bold, paragraphs) with nothing risky in it', () => {
    const result = sanitizeEmailHtml('<p>Hello <b>there</b></p><p>Second line</p>')
    expect(result).toBe('<p>Hello <b>there</b></p><p>Second line</p>')
  })
})
