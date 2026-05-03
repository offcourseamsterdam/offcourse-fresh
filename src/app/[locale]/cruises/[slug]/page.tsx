import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BookingPanel } from '@/components/booking/BookingPanel'
import { ImageGallery } from '@/components/cruise/ImageGallery'
import { StickyBookingHeader } from '@/components/cruise/StickyBookingHeader'
import { MobileBookingCTA } from '@/components/cruise/MobileBookingCTA'
import { CruiseContentSections } from '@/components/cruise/CruiseContentSections'
import { getListingBySlug, getCruisePageData } from '@/lib/cruise/get-cruise-page-data'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import { TrackPageView } from '@/components/tracking/TrackPageView'
import type { Locale } from '@/lib/i18n/config'

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
  const description = getLocalizedField(meta, 'seo_meta_description', loc) ?? meta.tagline ?? undefined
  const isPartnerInvoice = meta.payment_mode === 'partner_invoice'

  // Open Graph image — pick the optimised 1080px variant if available, else legacy hero
  const ogImageUrl = await getCruiseOgImage(meta)

  return {
    title: `${title} — Off Course Amsterdam`,
    description,
    openGraph: {
      title,
      description: description ?? undefined,
      ...(ogImageUrl ? { images: [{ url: ogImageUrl, alt: title }] } : {}),
    },
    twitter: ogImageUrl
      ? { card: 'summary_large_image', images: [ogImageUrl] }
      : undefined,
    // Partner-invoice listings are distributed only via physical QR codes.
    // Keep them out of search engines so the URL can't be found by accident.
    ...(isPartnerInvoice ? { robots: { index: false, follow: false } } : {}),
  }
}

/** Pick the best image URL for Open Graph cards — prefer optimised 1080px AVIF variant. */
async function getCruiseOgImage(listing: { id: string; hero_image_url: string | null; hero_image_asset_id?: string | null }): Promise<string | null> {
  if (!listing.hero_image_asset_id) return listing.hero_image_url
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data } = await supabase
    .from('image_assets')
    .select('variants, status')
    .eq('id', listing.hero_image_asset_id)
    .maybeSingle()
  if (!data || data.status !== 'complete') return listing.hero_image_url
  const variants = (data.variants as Array<{ width: number; webp_url: string; avif_url: string }>) ?? []
  // OG / Twitter cards prefer JPEG/WebP — pick 1080px WebP for max compatibility
  const ideal = variants.find(v => v.width === 1080) ?? variants[variants.length - 1]
  return ideal?.webp_url ?? listing.hero_image_url
}

export default async function CruiseListingPage({ params, searchParams }: Props) {
  const { locale, slug } = await params
  const { date, guests, time } = await searchParams
  const t = await getTranslations('cruises')

  const listing = await getListingBySlug(slug)
  if (!listing) notFound()

  const data = await getCruisePageData(listing, locale as Locale)

  // JSON-LD ImageObject for Google Images / Discover ranking
  const heroImage = await getCruiseHeroImageObject(listing, data.title)

  // JSON-LD structured data
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: data.title,
    description: data.tagline ?? undefined,
    ...(heroImage ? { image: heroImage } : {}),
    offers: listing.starting_price
      ? { '@type': 'Offer', priceCurrency: 'EUR', price: listing.starting_price, availability: 'https://schema.org/InStock' }
      : undefined,
    provider: { '@type': 'LocalBusiness', name: 'Off Course Amsterdam' },
  }

  // Shared booking panel props
  const bookingPanelProps = {
    listingId: listing.id,
    listingSlug: listing.slug,
    listingTitle: data.title,
    listingHeroImageUrl: data.heroUrl,
    category: listing.category as 'private' | 'shared',
    initialDate: date,
    initialGuests: guests ? Number(guests) : undefined,
    initialTime: time,
    cancellationPolicy: data.cancellationPolicy,
    startingPrice: listing.starting_price ?? null,
    infoPills: [
      ...(listing.duration_display ? [{ icon: 'duration' as const, label: listing.duration_display }] : []),
      ...(listing.max_guests ? [{ icon: 'guests' as const, label: `Up to ${listing.max_guests} guests` }] : []),
      { icon: 'category' as const, label: listing.category === 'private' ? t('private') : t('shared') },
    ],
  }

  return (
    <>
      <TrackPageView event="view_cruise_detail" metadata={{ slug, category: listing.category }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <StickyBookingHeader title={data.title} priceDisplay={listing.price_display} />
      <MobileBookingCTA />

      <div className="min-h-screen bg-texture-sand pb-24 lg:pb-0">

        {/* ── Hero ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 pb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{listing.category}</span>
          <h1 className="text-2xl sm:text-4xl font-black text-[var(--color-primary)] mt-2 uppercase">{data.title}</h1>
          {data.tagline && <p className="text-[var(--color-muted)] mt-1 text-sm sm:text-base">{data.tagline}</p>}

          {data.avgRating && data.totalReviews > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-primary)] text-white font-bold text-sm">{data.avgRating}</span>
              <div className="flex flex-col">
                <span className="text-sm">
                  <span className="font-bold text-[var(--color-ink)]">Exceptional</span>
                  <span className="text-[var(--color-muted)]"> &middot; {data.totalReviews} reviews</span>
                </span>
                <a href="#reviews" className="text-sm text-[var(--color-primary)] font-medium hover:underline">See all reviews</a>
              </div>
            </div>
          )}
        </div>

        {/* ── Gallery ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ImageGallery images={data.images} heroUrl={data.heroUrl} videoUrl={data.videoUrl} title={data.title} reviews={data.serializedReviews} reviewCount={data.reviewCount ?? undefined} />
        </div>

        {/* ── Inline booking (mobile/tablet) ── */}
        <div id="booking" className="lg:hidden max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="border-t border-gray-200 pt-6 mb-6" />
          <h2 className="font-avenir font-bold text-xl text-[var(--color-ink)] mb-6">Tickets and prices</h2>
          <BookingPanel {...bookingPanelProps} layout="inline" />
        </div>

        {/* ── Content + desktop sidebar ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <CruiseContentSections
              highlights={data.highlights}
              description={data.description}
              serializedFood={data.serializedFood}
              serializedDrinks={data.serializedDrinks}
              cancellationPolicy={data.cancellationPolicy}
              listingBoats={data.listingBoats}
              serializedReviews={data.serializedReviews}
              listing={listing}
              faqs={data.faqs}
              loc={data.loc}
              faqLabel={t('faq')}
            />

            {/* Desktop sidebar */}
            <div className="hidden lg:block lg:col-span-1">
              <div className="sticky top-24">
                <h3 className="font-briston text-[24px] text-[var(--color-primary)] uppercase mb-3">Book this cruise</h3>
                <BookingPanel {...bookingPanelProps} layout="sidebar" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}


/** Build a JSON-LD ImageObject from the optimised hero asset (or legacy URL). */
async function getCruiseHeroImageObject(
  listing: { id: string; hero_image_url: string | null; hero_image_asset_id?: string | null },
  alt: string,
) {
  if (listing.hero_image_asset_id) {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: asset } = await supabase
      .from('image_assets')
      .select('variants, alt_text, original_width, original_height, status')
      .eq('id', listing.hero_image_asset_id)
      .maybeSingle()
    if (asset && asset.status === 'complete') {
      const variants = (asset.variants as Array<{ width: number; avif_url: string; webp_url: string }>) ?? []
      const largest = variants[variants.length - 1]
      const altText = (asset.alt_text as Record<string, string> | null)?.en ?? alt
      return {
        '@type': 'ImageObject',
        url: largest?.webp_url ?? listing.hero_image_url,
        width: asset.original_width ?? undefined,
        height: asset.original_height ?? undefined,
        name: altText,
      }
    }
  }
  return listing.hero_image_url
    ? { '@type': 'ImageObject', url: listing.hero_image_url, name: alt }
    : null
}
