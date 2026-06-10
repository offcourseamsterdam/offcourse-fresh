import { notFound } from 'next/navigation'
import Image from 'next/image'
import type { Metadata } from 'next'
import {
  getAllPosts,
  getPostBySlug,
  featuredImage,
  featuredImageAlt,
  authorName,
  stripTags,
  postUrl,
  blogPath,
  blogUrl,
  SITE_URL,
} from '@/lib/wp/client'
import type { Locale } from '@/lib/i18n/config'

export const revalidate = 3600

interface Props {
  params: Promise<{ locale: string; slug: string }>
}

export async function generateStaticParams() {
  const posts = await getAllPosts()
  return posts.map(p => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const post = await getPostBySlug(slug)
  if (!post) return {}

  const url = postUrl(locale, post.slug)
  const img = featuredImage(post)
  const title = stripTags(post.title.rendered)
  const description = stripTags(post.excerpt.rendered) || undefined

  return {
    title: `${title} — Off Course Amsterdam`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title,
      description,
      url,
      images: img ? [img] : [],
    },
    twitter: img ? { card: 'summary_large_image', images: [img] } : undefined,
  }
}

export default async function BlogPost({ params }: Props) {
  const { locale, slug } = await params
  const loc = locale as Locale
  const post = await getPostBySlug(slug)
  if (!post) notFound()

  const url = postUrl(loc, post.slug)
  const img = featuredImage(post)
  const title = stripTags(post.title.rendered)
  const author = authorName(post)

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/${loc}` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: blogUrl(loc) },
      { '@type': 'ListItem', position: 3, name: title, item: url },
    ],
  }

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    image: img ? [img] : [],
    datePublished: post.date,
    dateModified: post.modified,
    author: { '@type': 'Person', name: author || 'Off Course Amsterdam' },
    publisher: { '@type': 'Organization', name: 'Off Course Amsterdam' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(article) }}
      />

      <article className="min-h-screen bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <a
            href={blogPath(loc)}
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-primary)] uppercase tracking-wider"
          >
            ← Blog
          </a>

          <h1
            className="text-3xl sm:text-5xl font-black text-[var(--color-primary)] uppercase leading-tight mt-4 mb-3"
            dangerouslySetInnerHTML={{ __html: post.title.rendered }}
          />

          <p className="text-sm text-[var(--color-muted)] mb-8">
            {author && <span>By {author} · </span>}
            <time dateTime={post.date}>
              {new Date(post.date).toLocaleDateString(loc, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
          </p>

          {img && (
            <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden bg-[var(--color-sand)] mb-10">
              <Image
                src={img}
                alt={featuredImageAlt(post) || title}
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                className="object-cover"
                priority
              />
            </div>
          )}

          <div
            className="text-[var(--color-ink)] leading-relaxed
              [&_p]:mb-5
              [&_h2]:text-2xl [&_h2]:sm:text-3xl [&_h2]:font-black [&_h2]:text-[var(--color-primary)] [&_h2]:mt-10 [&_h2]:mb-4
              [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-[var(--color-primary)] [&_h3]:mt-8 [&_h3]:mb-3
              [&_a]:text-[var(--color-accent)] [&_a]:underline
              [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-5
              [&_li]:mb-2
              [&_img]:rounded-2xl [&_img]:my-8 [&_img]:w-full [&_img]:h-auto
              [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--color-accent)] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[var(--color-muted)] [&_blockquote]:my-6
              [&_figure]:my-8 [&_figcaption]:text-sm [&_figcaption]:text-[var(--color-muted)] [&_figcaption]:mt-2"
            dangerouslySetInnerHTML={{ __html: post.content.rendered }}
          />
        </div>
      </article>
    </>
  )
}
