const WP = (process.env.WORDPRESS_URL ?? '').replace(/\/$/, '')
const POST_TYPE = process.env.WP_POST_TYPE ?? 'blog'
const REVALIDATE = 3600

export type WPPost = {
  id: number
  slug: string
  date: string
  modified: string
  title: { rendered: string }
  excerpt: { rendered: string }
  content: { rendered: string }
  _embedded?: {
    'wp:featuredmedia'?: { source_url: string; alt_text?: string }[]
    author?: { name: string }[]
  }
}

const BASE = `${WP}/wp-json/wp/v2/${POST_TYPE}`
const QUERY = '_embed&status=publish&orderby=date&order=desc'

export const isWordPressConfigured = () => WP.length > 0

export async function getAllPosts(): Promise<WPPost[]> {
  if (!isWordPressConfigured()) return []

  try {
    const perPage = 100
    const first = await fetch(`${BASE}?per_page=${perPage}&page=1&${QUERY}`, {
      next: { revalidate: REVALIDATE },
    })
    if (!first.ok) return []

    const totalPages = Number(first.headers.get('X-WP-TotalPages') ?? '1')
    const page1 = (await first.json()) as WPPost[]

    if (totalPages <= 1) return page1

    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        fetch(`${BASE}?per_page=${perPage}&page=${i + 2}&${QUERY}`, {
          next: { revalidate: REVALIDATE },
        })
          .then(r => (r.ok ? (r.json() as Promise<WPPost[]>) : []))
          .catch(() => [] as WPPost[]),
      ),
    )

    return page1.concat(...rest)
  } catch {
    return []
  }
}

export async function getPostBySlug(slug: string): Promise<WPPost | null> {
  if (!isWordPressConfigured()) return null

  try {
    const res = await fetch(
      `${BASE}?slug=${encodeURIComponent(slug)}&_embed&status=publish`,
      { next: { revalidate: REVALIDATE } },
    )
    if (!res.ok) return null
    const arr = (await res.json()) as WPPost[]
    return arr[0] ?? null
  } catch {
    return null
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export const featuredImage = (p: WPPost): string | null =>
  p._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null

export const featuredImageAlt = (p: WPPost): string =>
  p._embedded?.['wp:featuredmedia']?.[0]?.alt_text ?? ''

export const authorName = (p: WPPost): string =>
  p._embedded?.author?.[0]?.name ?? ''

export const stripTags = (html: string): string =>
  html.replace(/<[^>]*>/g, '').trim()

// ── Public URL builders ──────────────────────────────────────────────────────
// All URLs must use SITE_URL — never leak WORDPRESS_URL into canonicals,
// OG tags, JSON-LD, or the sitemap.

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
).replace(/\/$/, '')

export const blogPath = (locale: string): string => `/${locale}/blog`

export const blogUrl = (locale: string): string => `${SITE_URL}${blogPath(locale)}`

export const postUrl = (locale: string, slug: string): string =>
  `${SITE_URL}${blogPath(locale)}/${slug}`
