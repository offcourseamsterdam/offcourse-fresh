import { NextRequest, NextResponse } from 'next/server'
import { getPostBySlug, featuredImage, stripTags, postUrl } from '@/lib/wp/client'
import { locales, defaultLocale, type Locale } from '@/lib/i18n/config'
import { buildBlogMarkdown } from '@/lib/markdown/build-blog-markdown'

export const revalidate = 3600

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const localeParam = request.nextUrl.searchParams.get('locale')
  const locale: Locale = (locales as readonly string[]).includes(localeParam ?? '')
    ? (localeParam as Locale)
    : defaultLocale

  const post = await getPostBySlug(slug)
  if (!post) {
    return new NextResponse('Not found', { status: 404 })
  }

  const markdown = buildBlogMarkdown({
    title: stripTags(post.title.rendered),
    description: stripTags(post.excerpt.rendered),
    contentHtml: post.content.rendered,
    image: featuredImage(post),
    date: post.date,
    url: postUrl(locale, post.slug),
  })

  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      Vary: 'Accept',
    },
  })
}
