import { notFound } from 'next/navigation'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { BookingPanel } from '@/components/booking/BookingPanel'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import type { Locale } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'

type CruiseListing = Database['public']['Tables']['cruise_listings']['Row']

// JSONB field shapes (as stored by the edit page)
type CruiseImage = { url: string; alt_text?: string | null }
type Benefit = { text: string }
type Faq = { question: string; answer: string }

export const revalidate = 60

interface Props {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ date?: string; guests?: string; time?: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params
  const supabase = await createClient()

  const { data: listingData } = await supabase
    .from('cruise_listings')
    .select(
      'title, tagline, seo_title, seo_meta_description, seo_title_nl, seo_title_de, seo_title_fr, seo_title_es, seo_title_pt, seo_title_zh, seo_meta_description_nl, seo_meta_description_de, seo_meta_description_fr, seo_meta_description_es, seo_meta_description_pt, seo_meta_description_zh'
    )
    .eq('slug', slug)
    .eq('is_published', true)
    .single()

  if (!listingData) return {}

  const meta = listingData as CruiseListing
  const loc = locale as Locale
  const title = getLocalizedField(meta, 'seo_title', loc) ?? meta.title
  const description =
    getLocalizedField(meta, 'seo_meta_description', loc) ?? meta.tagline ?? undefined

  return {
    title: `${title} — Off Course Amsterdam`,
    description,
    openGraph: { title, description: description ?? undefined },
  }
}

export default async function CruiseListingPage({ params, searchParams }: Props) {
  const { locale, slug } = await params
  const { date, guests, time } = await searchParams
  const t = await getTranslations('cruises')
  const supabase = await createClient()

  const { data: listingData } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single()

  const listing = listingData as CruiseListing | null
  if (!listing) notFound()

  // All content lives in JSONB columns on the listing row (no separate tables)
  const images = (listing.images as CruiseImage[] | null) ?? []
  const benefits = (listing.benefits as Benefit[] | null) ?? []
  const highlights = (listing.highlights as Benefit[] | null) ?? []
  const inclusions = (listing.inclusions as Benefit[] | null) ?? []
  const faqs = (listing.faqs as Faq[] | null) ?? []
  const cancellationPolicy =
    typeof listing.cancellation_policy === 'string'
      ? listing.cancellation_policy
      : (listing.cancellation_policy as { text?: string } | null)?.text ?? null

  // Hero: prefer explicit hero_image_url, fall back to first image in the grid
  const heroUrl = listing.hero_image_url ?? images[0]?.url ?? null

  const loc = locale as Locale
  const title = getLocalizedField(listing, 'title', loc)
  const tagline = getLocalizedField(listing, 'tagline', loc)
  const description = getLocalizedField(listing, 'description', loc)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    description: tagline ?? undefined,
    offers: listing.starting_price
      ? {
          '@type': 'Offer',
          priceCurrency: 'EUR',
          price: listing.starting_price,
          availability: 'https://schema.org/InStock',
        }
      : undefined,
    provider: {
      '@type': 'LocalBusiness',
      name: 'Off Course Amsterdam',
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen bg-white">
        {/* Hero image */}
        <div className="relative h-64 sm:h-96 bg-[var(--color-primary)]">
          {heroUrl ? (
            <Image
              src={heroUrl}
              alt={title}
              fill
              priority
              className="object-cover"
              sizes="100vw"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary)]/70" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <div className="absolute bottom-6 left-6 right-6 text-white">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/70 capitalize">
              {listing.category}
            </span>
            <h1 className="text-3xl sm:text-4xl font-black mt-1">{title}</h1>
            {tagline && <p className="text-white/80 mt-1">{tagline}</p>}
          </div>
        </div>

        {/* Image gallery strip — show non-hero images */}
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto p-4 bg-[var(--color-sand)]">
            {images
              .filter(img => img.url !== listing.hero_image_url)
              .map((img, i) => (
                <div
                  key={img.url + i}
                  className="relative flex-shrink-0 w-24 h-20 sm:w-32 sm:h-24 rounded-lg overflow-hidden"
                >
                  <Image
                    src={img.url}
                    alt={img.alt_text ?? ''}
                    fill
                    className="object-cover"
                    sizes="128px"
                  />
                </div>
              ))}
          </div>
        )}

        {/* Main content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Left: content */}
            <div className="lg:col-span-2 space-y-10">

              {/* Quick info pills */}
              <div className="flex flex-wrap gap-3">
                {listing.departure_location && (
                  <span className="flex items-center gap-1.5 text-sm text-[var(--color-foreground)] bg-[var(--color-sand)] px-3 py-1.5 rounded-full">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--color-primary)]" fill="currentColor">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                    </svg>
                    {listing.departure_location}
                  </span>
                )}
                {listing.duration_display && (
                  <span className="flex items-center gap-1.5 text-sm text-[var(--color-foreground)] bg-[var(--color-sand)] px-3 py-1.5 rounded-full">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--color-primary)]" fill="currentColor">
                      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
                    </svg>
                    {listing.duration_display}
                  </span>
                )}
                {listing.max_guests && (
                  <span className="flex items-center gap-1.5 text-sm text-[var(--color-foreground)] bg-[var(--color-sand)] px-3 py-1.5 rounded-full">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--color-primary)]" fill="currentColor">
                      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                    </svg>
                    Up to {listing.max_guests} guests
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-sm text-[var(--color-foreground)] bg-[var(--color-sand)] px-3 py-1.5 rounded-full capitalize">
                  {listing.category === 'private' ? t('private') : t('shared')}
                </span>
              </div>

              {/* Description */}
              {description && (
                <p className="text-[var(--color-foreground)] leading-relaxed text-base whitespace-pre-line">
                  {description}
                </p>
              )}

              {/* Highlights */}
              {highlights.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold text-[var(--color-primary)] mb-4">
                    Highlights
                  </h2>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {highlights.map((h, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
                          <Check className="w-3 h-3" />
                        </span>
                        <span className="text-sm text-[var(--color-foreground)]">{h.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Inclusions */}
              {inclusions.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold text-[var(--color-primary)] mb-4">
                    What&apos;s included
                  </h2>
                  <ul className="space-y-2">
                    {inclusions.map((inc, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center">
                          <Check className="w-3 h-3" />
                        </span>
                        <span className="text-sm text-[var(--color-foreground)]">{inc.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Benefits */}
              {benefits.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold text-[var(--color-primary)] mb-4">
                    Why you&apos;ll love it
                  </h2>
                  <ul className="space-y-3">
                    {benefits.map((b, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-accent)] text-white flex items-center justify-center">
                          <Check className="w-3 h-3" />
                        </span>
                        <span className="text-[var(--color-foreground)]">{b.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* FAQ */}
              {faqs.length > 0 && (
                <section>
                  <h2 className="text-xl font-bold text-[var(--color-primary)] mb-4">{t('faq')}</h2>
                  <div className="space-y-4">
                    {faqs.map((faq, i) => (
                      <details
                        key={i}
                        className="group border border-gray-100 rounded-xl overflow-hidden"
                      >
                        <summary className="flex items-center justify-between p-4 cursor-pointer font-semibold text-[var(--color-primary)] hover:bg-[var(--color-sand)] transition-colors">
                          {faq.question}
                          <svg
                            viewBox="0 0 24 24"
                            className="w-5 h-5 flex-shrink-0 transition-transform group-open:rotate-180"
                            fill="currentColor"
                          >
                            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                          </svg>
                        </summary>
                        <div className="p-4 pt-0 text-[var(--color-foreground)] text-sm leading-relaxed border-t border-gray-100">
                          {faq.answer}
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              )}

              {/* Cancellation policy */}
              {cancellationPolicy && (
                <section>
                  <h2 className="text-xl font-bold text-[var(--color-primary)] mb-3">
                    Cancellation policy
                  </h2>
                  <p className="text-sm text-[var(--color-muted)] leading-relaxed whitespace-pre-line">
                    {cancellationPolicy}
                  </p>
                </section>
              )}
            </div>

            {/* Right: booking widget */}
            <div className="lg:col-span-1">
              <div className="sticky top-24">
                {listing.price_display && (
                  <div className="mb-4">
                    <p className="text-xs text-[var(--color-muted)]">{t('startingFrom')}</p>
                    <p className="text-3xl font-black text-[var(--color-primary)]">
                      {listing.price_display}
                    </p>
                    {listing.price_label && (
                      <p className="text-sm text-[var(--color-muted)]">{listing.price_label}</p>
                    )}
                  </div>
                )}
                <BookingPanel
                  listingId={listing.id}
                  listingSlug={listing.slug}
                  listingTitle={title}
                  listingHeroImageUrl={heroUrl}
                  category={listing.category as 'private' | 'shared'}
                  initialDate={date}
                  initialGuests={guests ? Number(guests) : undefined}
                  initialTime={time}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
