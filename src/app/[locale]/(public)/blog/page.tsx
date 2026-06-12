import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import {
  getAllPosts,
  featuredImage,
  featuredImageAlt,
  stripTags,
  blogPath,
  blogUrl,
  SITE_URL,
} from '@/lib/wp/client'
import type { Locale } from '@/lib/i18n/config'

export const revalidate = 3600

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return {
    title: 'Blog — Off Course Amsterdam',
    description: 'Stories, hidden gems, and local rhythm from your friend with a boat.',
    alternates: { canonical: blogUrl(locale) },
  }
}

export default async function BlogArchive({ params }: Props) {
  const { locale } = await params
  const loc = locale as Locale
  const posts = await getAllPosts()

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/${loc}` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: blogUrl(loc) },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />

      <div className="min-h-screen bg-white">
        <div className="bg-[var(--color-primary)] text-white py-16 sm:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl sm:text-5xl font-black mb-4">Blog</h1>
            <p className="text-white/70 text-lg max-w-xl mx-auto">
              Stories, hidden gems, and local rhythm — from the water.
            </p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          {posts.length === 0 ? (
            <p className="text-center text-[var(--color-muted)]">
              No stories yet — check back soon.
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map(p => {
                const img = featuredImage(p)
                const title = stripTags(p.title.rendered)
                return (
                  <li key={p.id} className="group">
                    <Link href={`${blogPath(loc)}/${p.slug}`} className="block">
                      <div className="relative aspect-[16/10] w-full rounded-2xl overflow-hidden bg-[var(--color-sand)] mb-4">
                        {img && (
                          <Image
                            src={img}
                            alt={featuredImageAlt(p) || title}
                            fill
                            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        )}
                      </div>
                      <h2 className="font-bold text-lg text-[var(--color-primary)] leading-snug group-hover:text-[var(--color-accent)] transition-colors">
                        {title}
                      </h2>
                    </Link>
                    <div
                      className="text-sm text-[var(--color-muted)] leading-relaxed mt-2 [&_p]:m-0 line-clamp-3"
                      dangerouslySetInnerHTML={{ __html: p.excerpt.rendered }}
                    />
                    <time
                      dateTime={p.date}
                      className="block text-xs text-[var(--color-muted)] mt-3 uppercase tracking-wider"
                    >
                      {new Date(p.date).toLocaleDateString(loc, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </time>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
