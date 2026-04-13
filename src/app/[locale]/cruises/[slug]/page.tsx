import { cache } from 'react'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import { Check } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { BookingPanel } from '@/components/booking/BookingPanel'
import { ImageGallery } from '@/components/cruise/ImageGallery'
import { ExtrasGrid } from '@/components/cruise/ExtrasGrid'
import { ReviewSlider } from '@/components/cruise/ReviewSlider'
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

  // Fetch boats for the "Our boats" section, filtered by allowed customer types
  const { data: allBoats } = await supabase
    .from('boats')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  // Filter boats: only show boats whose customer_type_pks overlap with the listing's allowed types
  const allowedCtPks = listing.allowed_customer_type_pks as number[] | null
  const listingBoats = (allBoats ?? []).filter((boat) => {
    if (!allowedCtPks || allowedCtPks.length === 0) return true // no filter = show all
    const boatCtPks = (boat.fareharbor_customer_type_pks as number[] | null) ?? []
    return boatCtPks.some((pk) => allowedCtPks.includes(pk))
  })

  // All content lives in JSONB columns on the listing row (no separate tables)
  const images = (listing.images as CruiseImage[] | null) ?? []
  const highlights = (listing.highlights as Benefit[] | null) ?? []
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

  // Serialize reviews for client-side components (gallery popup + review slider)
  const serializedReviews = (reviews ?? []).map((r) => ({
    id: r.id,
    reviewer_name: r.reviewer_name,
    review_text: getLocalizedField(r, 'review_text', loc),
    rating: r.rating,
    source: r.source,
    author_photo_url: r.author_photo_url,
    publish_time: r.publish_time,
  }))

  // Serialize extras for the client-side ExtrasGrid component
  const serializedFood = foodExtras.map((e) => ({
    id: e.id,
    name: getLocalizedField(e, 'name', loc),
    description: getLocalizedField(e, 'description', loc) || null,
    image_url: e.image_url,
    ingredients: e.ingredients,
    price_display: formatExtraPrice(e),
  }))
  const serializedDrinks = drinkExtras.map((e) => ({
    id: e.id,
    name: getLocalizedField(e, 'name', loc),
    description: getLocalizedField(e, 'description', loc) || null,
    image_url: e.image_url,
    ingredients: e.ingredients,
    price_display: formatExtraPrice(e),
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 pb-6">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            {listing.category}
          </span>
          <h1 className="text-3xl sm:text-4xl font-black text-[var(--color-primary)] mt-3 uppercase">
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
            reviews={serializedReviews}
            reviewCount={reviewCount ?? undefined}
          />
        </div>

        {/* ── Main content ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Left: content */}
            <div className="lg:col-span-2 space-y-10">

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

              {/* Description */}
              {description && (
                <div
                  className="text-[var(--color-ink)] leading-relaxed text-base prose prose-sm max-w-none [&_p]:mb-4 [&_br]:block"
                  dangerouslySetInnerHTML={{ __html: description }}
                />
              )}

              {/* Things you need to know */}
              {(serializedFood.length > 0 || serializedDrinks.length > 0 || cancellationPolicy) && (
                <section>
                  <h2 className="font-palmore text-[32px] sm:text-[40px] text-[var(--color-accent)] mb-6">
                    Things you need to know
                  </h2>
                  <ExtrasGrid
                    foodExtras={serializedFood}
                    drinkExtras={serializedDrinks}
                    cancellationPolicy={cancellationPolicy}
                  />
                </section>
              )}

              {/* Our boats */}
              {listingBoats.length > 0 && (
                <section>
                  <h2 className="font-palmore text-[32px] sm:text-[40px] text-[var(--color-accent)] mb-6">
                    Our boats
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {listingBoats.map((boat) => (
                      <div key={boat.id} className="bg-white rounded-xl overflow-hidden shadow-sm">
                        {boat.photo_url && (
                          <div className="relative w-full aspect-[16/10]">
                            <Image
                              src={boat.photo_url}
                              alt={boat.name}
                              fill
                              className="object-cover"
                              sizes="(min-width: 640px) 50vw, 100vw"
                            />
                          </div>
                        )}
                        <div className="p-4">
                          <h3 className="font-avenir font-bold text-lg text-[var(--color-primary)]">
                            {boat.name}
                          </h3>
                          <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-muted)]">
                            {boat.max_capacity && (
                              <span>Up to {boat.max_capacity} guests</span>
                            )}
                            {boat.is_electric && (
                              <span>Electric</span>
                            )}
                          </div>
                          {boat.description && (
                            <p className="text-sm text-[var(--color-ink)] mt-2 line-clamp-3">
                              {getLocalizedField(boat, 'description', loc)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Reviews */}
              {reviews && reviews.length > 0 && (
                <ReviewSlider reviews={serializedReviews} />
              )}

              {/* Meeting point map */}
              <section>
                <h2 className="font-palmore text-[32px] sm:text-[40px] text-[var(--color-accent)] mb-4">
                  Where we meet
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
                    src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2435.4996052156116!2d4.888518977372259!3d52.37949287202471!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47c60937bd90461f%3A0x242f1bc48df48c07!2sOff~Course%20Canal%20Cruises!5e0!3m2!1sen!2snl!4v1776093877188!5m2!1sen!2snl"
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    title="Off Course Canal Cruises — meeting point"
                  />
                </div>
              </section>

              {/* FAQ (at the bottom) */}
              {faqs.length > 0 && (
                <section>
                  <h2 className="font-palmore text-[32px] sm:text-[40px] text-[var(--color-accent)] mb-4">{t('faq')}</h2>
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
                  infoPills={[
                    ...(listing.duration_display ? [{ icon: 'duration' as const, label: listing.duration_display }] : []),
                    ...(listing.max_guests ? [{ icon: 'guests' as const, label: `Up to ${listing.max_guests} guests` }] : []),
                    { icon: 'category' as const, label: listing.category === 'private' ? t('private') : t('shared') },
                    ...(listing.price_display ? [{ icon: 'price' as const, label: `From ${listing.price_display}` }] : []),
                  ]}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
