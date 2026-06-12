import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  featuredImage,
  featuredImageAlt,
  authorName,
  stripTags,
  blogPath,
  blogUrl,
  postUrl,
  SITE_URL,
  isWordPressConfigured,
  getAllPosts,
  getPostBySlug,
  type WPPost,
} from './client'

// Minimal post factory for helper tests.
const makePost = (overrides: Partial<WPPost> = {}): WPPost => ({
  id: 1,
  slug: 'hello-world',
  date: '2026-01-01T00:00:00',
  modified: '2026-01-02T00:00:00',
  title: { rendered: 'Hello <em>World</em>' },
  excerpt: { rendered: '<p>An excerpt.</p>' },
  content: { rendered: '<p>Body.</p>' },
  ...overrides,
})

// ── stripTags ────────────────────────────────────────────────────────────────

describe('stripTags', () => {
  it('removes HTML tags', () => {
    expect(stripTags('Hello <em>World</em>')).toBe('Hello World')
  })

  it('trims whitespace', () => {
    expect(stripTags('  <p>x</p>  ')).toBe('x')
  })

  it('handles plain strings unchanged', () => {
    expect(stripTags('no tags here')).toBe('no tags here')
  })

  it('handles empty string', () => {
    expect(stripTags('')).toBe('')
  })
})

// ── featuredImage / featuredImageAlt / authorName ────────────────────────────

describe('embedded helpers', () => {
  it('extracts the featured image URL', () => {
    const post = makePost({
      _embedded: { 'wp:featuredmedia': [{ source_url: 'https://cms/img.jpg', alt_text: 'A boat' }] },
    })
    expect(featuredImage(post)).toBe('https://cms/img.jpg')
    expect(featuredImageAlt(post)).toBe('A boat')
  })

  it('returns null when there is no featured image', () => {
    expect(featuredImage(makePost())).toBeNull()
    expect(featuredImageAlt(makePost())).toBe('')
  })

  it('extracts the author name, falling back to empty string', () => {
    const withAuthor = makePost({ _embedded: { author: [{ name: 'Jannah' }] } })
    expect(authorName(withAuthor)).toBe('Jannah')
    expect(authorName(makePost())).toBe('')
  })
})

// ── URL builders ─────────────────────────────────────────────────────────────

describe('URL builders', () => {
  it('builds locale-aware archive paths and URLs', () => {
    expect(blogPath('en')).toBe('/en/blog')
    expect(blogPath('nl')).toBe('/nl/blog')
    expect(blogUrl('en')).toBe(`${SITE_URL}/en/blog`)
  })

  it('builds locale-aware post URLs', () => {
    expect(postUrl('de', 'my-slug')).toBe(`${SITE_URL}/de/blog/my-slug`)
  })

  it('never points at the WordPress backend', () => {
    // The public URLs must always use the site origin, never WORDPRESS_URL.
    expect(blogUrl('en').startsWith(SITE_URL)).toBe(true)
    expect(postUrl('en', 'x').startsWith(SITE_URL)).toBe(true)
  })
})

// ── Resilience: unconfigured WordPress ───────────────────────────────────────
// In the test env WORDPRESS_URL is unset, so reads must no-op to empty, not throw.

describe('resilience when WordPress is unconfigured', () => {
  it('reports as not configured', () => {
    expect(isWordPressConfigured()).toBe(false)
  })

  it('getAllPosts returns [] without throwing', async () => {
    await expect(getAllPosts()).resolves.toEqual([])
  })

  it('getPostBySlug returns null without throwing', async () => {
    await expect(getPostBySlug('anything')).resolves.toBeNull()
  })
})

// ── Resilience: network failures (fetch mocked) ──────────────────────────────
// These exercise the guarded fetch paths. Because WORDPRESS_URL is unset the
// public helpers short-circuit, so we assert the mock is never hit — proving the
// guard protects against accidental requests to an unconfigured backend.

describe('does not hit the network when unconfigured', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('should not be called'))))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getAllPosts skips fetch entirely', async () => {
    await getAllPosts()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('getPostBySlug skips fetch entirely', async () => {
    await getPostBySlug('x')
    expect(fetch).not.toHaveBeenCalled()
  })
})
