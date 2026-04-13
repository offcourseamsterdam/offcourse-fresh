import { cache } from 'react'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { BookingPanel } from '@/components/booking/BookingPanel'
import { CruiseReviews } from '@/components/sections/CruiseReviews'
import { ImageGallery } from '@/components/cruise/ImageGallery'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import { formatExtraPrice } from '@/lib/constants'
import type { Locale } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'

type CruiseListing = Database['public']['Tables']['cruise_listings']['Row']

// Deduplicate the listing fetch between generateMetadata and the page component
const getListingBySlug = cache(async (slug: string) => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single()
  return data as CruiseListing | null
})

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

  const meta = await getListingBySlug(slug)
  if (!meta) return {}
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

  const listing = await getListingBySlug(slug)
  if (!listing) notFound()

  // Fetch active reviews for gallery popup + reviews section
  const supabase = await createClient()
  const { data: reviews } = await supabase
    .from('social_proof_reviews')
    .select('*')
    .eq('is_active', true)
    .order('rating', { ascending: false })
    .limit(6)

  // Total review count for the rating badge
  const { count: reviewCount } = await supabase
    .from('social_proof_reviews')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  // Fetch food & drink extras for the "Things you need to know" section
  const { data: allExtras } = await supabase
    .from('extras')
    .select('*')
    .eq('is_active', true)
    .in('category', ['food', 'drinks'])
    .order('sort_order', { ascending: true })

  const { data: listingExtrasOverrides } = await supabase
    .from('listing_extras')
    .select('extra_id, is_enabled')
    .eq('listing_id', listing.id)

  const overrideMap = new Map(
    (listingExtrasOverrides ?? []).map((o) => [o.extra_id, o.is_enabled])
  )

  const foodAndDrinkExtras = (allExtras ?? []).filter((extra) => {
    if (extra.scope === 'global') {
      if (
        extra.applicable_categories &&
        !extra.applicable_categories.includes(listing.category ?? '')
      )
        return false
      if (overrideMap.get(extra.id) === false) return false
      return true
    }
    return overrideMap.get(extra.id) === true
  })

  const foodExtras = foodAndDrinkExtras.filter((e) => e.category === 'food')
  const drinkExtras = foodAndDrinkExtras.filter((e) => e.category === 'drinks')

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

  // Serialize reviews for the client-side gallery component
  const galleryReviews = (reviews ?? []).map((r) => ({
    id: r.id,
    reviewer_name: r.reviewer_name,
    review_text: getLocalizedField(r, 'review_text', loc),
    rating: r.rating,
    source: r.source,
    author_photo_url: r.author_photo_url,
  }))

  // Video URL from listing (optional — only shown when present)
  const videoUrl = listing.video_url

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen bg-texture-sand">
        {/* ── Title + tagline above gallery ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            {listing.category}
          </span>
          <h1 className="text-3xl sm:text-4xl font-black text-[var(--color-primary)] mt-2">
            {title}
          </h1>
          {tagline && (
            <p className="text-[var(--color-muted)] mt-2 text-base">{tagline}</p>
          )}
        </div>

        {/* ── Image gallery (Booking.com-style grid) ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ImageGallery
            images={images}
            heroUrl={heroUrl}
            videoUrl={videoUrl}
            title={title}
            reviews={galleryReviews}
            reviewCount={reviewCount ?? undefined}
          />
        </div>

        {/* ── Main content ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Left: content */}
            <div className="lg:col-span-2 space-y-10">

              {/* Quick info pills */}
              <div className="flex flex-wrap gap-3">
                {listing.departure_location && (
                  <span className="flex items-center gap-1.5 text-sm text-[var(--color-ink)] bg-white px-3 py-1.5 rounded-full shadow-sm">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--color-primary)]" fill="currentColor">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                    </svg>
                    {listing.departure_location}
                  </span>
                )}
                {listing.duration_display && (
                  <span className="flex items-center gap-1.5 text-sm text-[var(--color-ink)] bg-white px-3 py-1.5 rounded-full shadow-sm">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--color-primary)]" fill="currentColor">
                      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
                    </svg>
                    {listing.duration_display}
                  </span>
                )}
                {listing.max_guests && (
                  <span className="flex items-center gap-1.5 text-sm text-[var(--color-ink)] bg-white px-3 py-1.5 rounded-full shadow-sm">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--color-primary)]" fill="currentColor">
                      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                    </svg>
                    Up to {listing.max_guests} guests
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-sm text-[var(--color-ink)] bg-white px-3 py-1.5 rounded-full shadow-sm capitalize">
                  {listing.category === 'private' ? t('private') : t('shared')}
                </span>
              </div>

              {/* Description */}
              {description && (
                <div
                  className="text-[var(--color-ink)] leading-relaxed text-base prose prose-sm max-w-none [&_p]:mb-4 [&_br]:block"
                  dangerouslySetInnerHTML={{ __html: description }}
                />
              )}

              {/* Departure point map */}
              {(listing.google_maps_url || listing.departure_location) && (
                <section>
                  <h2 className="text-xl font-bold text-[var(--color-primary)] mb-4">
                    Meeting point
                  </h2>
                  {listing.departure_location && (
                    <p className="text-sm text-[var(--color-ink)] mb-3 flex items-center gap-1.5">
                      <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" fill="currentColor">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                      </svg>
                      {listing.departure_location}
                    </p>
                  )}
                  <div className="rounded-xl overflow-hidden shadow-sm aspect-[16/9]">
                    <iframe
                      src={listing.google_maps_url ?? `https://www.google.com/maps/embed/v1/place?key=${process.env.GOOGLE_PLACES_API_KEY}&q=Off+Course+Amsterdam&zoom=15`}
                      width="100%"
                      height="100%"
                      style={{ border: 0 }}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      title={`Map — ${listing.departure_location ?? 'Departure point'}`}
                    />
                  </div>
                </section>
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
                        <span className="text-sm text-[var(--color-ink)]">{h.text}</span>
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
                        <span className="text-sm text-[var(--color-ink)]">{inc.text}</span>
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
                        <span className="text-[var(--color-ink)]">{b.text}</span>
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
                        className="group border border-gray-100 rounded-xl overflow-hidden bg-white"
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
                        <div className="p-4 pt-0 text-[var(--color-ink)] text-sm leading-relaxed border-t border-gray-100">
                          {faq.answer}
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              )}

              {/* Things you need to know */}
              {(foodExtras.length > 0 || drinkExtras.length > 0 || cancellationPolicy) && (
                <section>
                  <h2 className="font-briston text-[28px] sm:text-[36px] text-[var(--color-accent)] uppercase tracking-wide mb-6">
                    Things you need to know
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Food column */}
                    {foodExtras.length > 0 && (
                      <div className="bg-white rounded-xl p-5 shadow-sm">
                        <h3 className="font-palmore text-[20px] text-[var(--color-primary)] mb-4">
                          Food
                        </h3>
                        <div className="space-y-4">
                          {foodExtras.map((extra) => (
                            <div key={extra.id} className="flex gap-3">
                              {extra.image_url && (
                                <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                                  <Image
                                    src={extra.image_url}
                                    alt={getLocalizedField(extra, 'name', loc)}
                                    fill
                                    className="object-cover"
                                    sizes="64px"
                                  />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                                    {getLocalizedField(extra, 'name', loc)}
                                  </p>
                                  <span className="text-sm font-semibold text-[var(--color-primary)] flex-shrink-0">
                                    {formatExtraPrice(extra)}
                                  </span>
                                </div>
                                {extra.description && (
                                  <p className="text-xs text-[var(--color-muted)] mt-0.5">
                                    {getLocalizedField(extra, 'description', loc)}
                                  </p>
                                )}
                                {extra.ingredients && extra.ingredients.length > 0 && (
                                  <p className="text-xs text-[var(--color-muted)] mt-1">
                                    {extra.ingredients.join(' · ')}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Drinks column */}
                    {drinkExtras.length > 0 && (
                      <div className="bg-white rounded-xl p-5 shadow-sm">
                        <h3 className="font-palmore text-[20px] text-[var(--color-primary)] mb-4">
                          Drinks
                        </h3>
                        <div className="space-y-4">
                          {drinkExtras.map((extra) => (
                            <div key={extra.id} className="flex gap-3">
                              {extra.image_url && (
                                <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                                  <Image
                                    src={extra.image_url}
                                    alt={getLocalizedField(extra, 'name', loc)}
                                    fill
                                    className="object-cover"
                                    sizes="64px"
                                  />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                                    {getLocalizedField(extra, 'name', loc)}
                                  </p>
                                  <span className="text-sm font-semibold text-[var(--color-primary)] flex-shrink-0">
                                    {formatExtraPrice(extra)}
                                  </span>
                                </div>
                                {extra.description && (
                                  <p className="text-xs text-[var(--color-muted)] mt-0.5">
                                    {getLocalizedField(extra, 'description', loc)}
                                  </p>
                                )}
                                {extra.ingredients && extra.ingredients.length > 0 && (
                                  <p className="text-xs text-[var(--color-muted)] mt-1">
                                    {extra.ingredients.join(' · ')}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Cancellation policy — spans both columns */}
                    {cancellationPolicy && (
                      <div className="bg-white rounded-xl p-5 shadow-sm sm:col-span-2">
                        <h3 className="font-palmore text-[20px] text-[var(--color-primary)] mb-3">
                          Cancellation Policy
                        </h3>
                        <p className="text-sm text-[var(--color-muted)] leading-relaxed whitespace-pre-line">
                          {cancellationPolicy}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Reviews */}
              {reviews && reviews.length > 0 && (
                <CruiseReviews reviews={reviews} locale={locale as Locale} />
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
