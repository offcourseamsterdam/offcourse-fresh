import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Clock, Users, Umbrella } from 'lucide-react'
import { BookingPanel } from '@/components/booking/BookingPanel'
import { PrideEventWhatsAppCard } from '@/components/booking/PrideEventWhatsAppCard'
import { ImageGallery } from '@/components/cruise/ImageGallery'
import { StickyBookingHeader } from '@/components/cruise/StickyBookingHeader'
import { MobileBookingCTA } from '@/components/cruise/MobileBookingCTA'
import { RainbowCursorTrail } from '@/components/cruise/RainbowCursorTrail'
import { CruiseContentSections } from '@/components/cruise/CruiseContentSections'
import { getListingBySlug, getCruisePageData } from '@/lib/cruise/get-cruise-page-data'
import { AvailabilityFiltersSchema } from '@/lib/fareharbor/filters'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import { TrackPageView } from '@/components/tracking/TrackPageView'
import type { Locale } from '@/lib/i18n/config'
import type { ImageAsset } from '@/lib/images/types'

export const revalidate = 60

interface Props {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ date?: string; guests?: string; time?: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params
  const listing = await getListingBySlug(slug)
  if (!listing) return {}
  const loc = locale as Locale
  const title = getLocalizedField(listing, 'seo_title', loc) ?? listing.title
  const description = getLocalizedField(listing, 'seo_meta_description', loc) ?? listing.tagline ?? undefined
  const isPartnerInvoice = listing.payment_mode === 'partner_invoice'

  // getCruisePageData is wrapped with React cache() and already fetches the hero asset
  // in its parallel batch — so calling it here derives the OG image URL for free,
  // eliminating the separate serial DB query (getCruiseOgImage) that used to run here.
  const data = await getCruisePageData(listing, loc)

  return {
    title: `${title} — Off Course Amsterdam`,
    description,
    openGraph: {
      title,
      description: description ?? undefined,
      ...(data.ogImageUrl ? { images: [{ url: data.ogImageUrl, alt: title }] } : {}),
    },
    twitter: data.ogImageUrl
      ? { card: 'summary_large_image', images: [data.ogImageUrl] }
      : undefined,
    // Partner-invoice listings are distributed only via physical QR codes.
    // Keep them out of search engines so the URL can't be found by accident.
    ...(isPartnerInvoice ? { robots: { index: false, follow: false } } : {}),
  }
}

export default async function CruiseListingPage({ params, searchParams }: Props) {
  const { locale, slug } = await params
  const { date, guests, time } = await searchParams
  const t = await getTranslations('cruises')

  const listing = await getListingBySlug(slug)
  if (!listing) notFound()

  const data = await getCruisePageData(listing, locale as Locale)

  // JSON-LD ImageObject for Google Images / Discover ranking
  const heroImage = buildCruiseHeroImageObject(data.heroAsset, listing.hero_image_url, data.title)

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

  // FAQPage JSON-LD — lets AI answer engines and Google lift these Q&As
  // directly into generated answers. Omitted entirely when a listing has no
  // FAQs rather than emitting an empty (invalid) FAQPage block.
  const faqJsonLd = data.faqs.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: data.faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  } : null

  // Fixed-date special events (this item only has real availability on their one
  // scheduled day) get a distinct, simplified presentation throughout: they
  // default straight to that day instead of "today" (which would otherwise
  // always show as fully-booked), skip the multi-day date scroller entirely,
  // and pick up the rainbow theme across headings/boat card/time button.
  // One config object per event rather than several parallel lookup maps.
  const SPECIAL_EVENTS: Record<string, { date: string; mapCoords: string }> = {
    'pride-amsterdam-2026': { date: '2026-08-01', mapCoords: '52.369684,4.910362' },
  }
  const specialEvent = SPECIAL_EVENTS[listing.slug]
  const isSpecialEvent = Boolean(specialEvent)
  const specialEventDate = specialEvent?.date
  // Whole-boat total only applies to a PRIVATE special event (a single
  // fixed-price charter) — the headline number is the boat price (per-person
  // rate × capacity), not a "starting from". A SHARED special event (e.g.
  // Pride Amsterdam 2026 — Pride Party Boat) sells per-person tickets off a
  // shared pool, same pricing shape as any other shared listing, so there's
  // no "whole boat" total to show.
  const fullBoatPrice = specialEvent && listing.category === 'private' && listing.starting_price != null && listing.max_guests
    ? listing.starting_price * listing.max_guests
    : null

  // One tidy icon + label row — replaces the chunky stacked pills for a cleaner
  // vertical rhythm on the narrow booking sidebar.
  const metaRow = (icon: React.ReactNode, label: React.ReactNode) => (
    <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
      <span className="flex-shrink-0 text-[var(--color-primary)]">{icon}</span>
      <span>{label}</span>
    </div>
  )

  const cruisingMeta = (
    <div className="flex flex-col gap-2">
      {listing.duration_display && metaRow(<Clock className="w-4 h-4" />, listing.duration_display)}
      {listing.max_guests && metaRow(<Users className="w-4 h-4" />, `Up to ${listing.max_guests} guests`)}
      {metaRow(<Umbrella className="w-4 h-4" />, 'Covered canopy')}
    </div>
  )

  // Section header shared by mobile inline + desktop sidebar.
  const renderStartCruisingHeader = () =>
    isSpecialEvent ? (
      // Special event: heading on its own row (so "CRUISING" never gets clipped
      // by a competing price column), price leading (whole-boat total for a
      // private charter, straight per-person for a shared one), open-bar
      // accent, then the clean meta list.
      <div className="mb-4 sm:mb-6">
        <h2 className="font-briston text-[28px] sm:text-[36px] uppercase leading-none text-rainbow-gradient">
          Start Cruising
        </h2>
        {fullBoatPrice != null ? (
          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <p className="font-palmore text-4xl text-[var(--color-primary)] leading-none">
                €{listing.starting_price}
              </p>
              <span className="text-sm text-[var(--color-muted)]">per person</span>
            </div>
            <p className="text-sm text-[var(--color-ink)] mt-1.5">
              €{fullBoatPrice.toLocaleString('en-US')} whole boat
            </p>
            <span className="inline-flex items-center gap-1 mt-2.5 text-xs font-semibold text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2.5 py-1 rounded-full">
              🥂 Open bar included
            </span>
          </div>
        ) : listing.starting_price != null && (
          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <p className="font-palmore text-4xl text-[var(--color-primary)] leading-none">
                €{listing.starting_price}
              </p>
              <span className="text-sm text-[var(--color-muted)]">per person</span>
            </div>
            <span className="inline-flex items-center gap-1 mt-2.5 text-xs font-semibold text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2.5 py-1 rounded-full">
              🥂 Open bar included
            </span>
          </div>
        )}
        <div className="mt-4">{cruisingMeta}</div>
      </div>
    ) : (
      // Standard listing: price varies by boat/duration, so "starting from" is
      // correct. Two-column layout unchanged.
      <div className="flex items-end justify-between gap-4 mb-4 sm:mb-6">
        <div className="flex-1 min-w-0">
          <h2 className="font-briston text-[28px] sm:text-[36px] uppercase leading-none text-[var(--color-accent)]">
            Start Cruising
          </h2>
          <div className="mt-3">{cruisingMeta}</div>
        </div>
        {listing.starting_price != null && (
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-[var(--color-muted)] leading-none mb-1">starting from</p>
            <p className="font-palmore text-3xl text-[var(--color-primary)] leading-none">€{listing.starting_price}</p>
          </div>
        )}
      </div>
    )

  // Shared booking panel props
  // Default the booking widget to today (Amsterdam tz) for direct landings, so the
  // widget loads with a date pre-selected and an immediate CTA instead of a passive
  // date picker. Search arrivals (?date=) keep their chosen date. en-CA → YYYY-MM-DD.
  const amsterdamToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date())

  // Which boats this listing actually offers (vs. just unavailable today) — lets
  // BoatDurationStep omit a boat card entirely rather than show it as "sold out".
  const offeredBoatIds = data.listingBoats
    .map(b => (b.name.toLowerCase().includes('diana') ? 'diana' : 'curacao'))

  const parsedAvailabilityFilters = AvailabilityFiltersSchema.safeParse(listing.availability_filters)
  const minPartyOverride = parsedAvailabilityFilters.success
    ? parsedAvailabilityFilters.data.min_guests_override ?? null
    : null

  const bookingPanelProps = {
    listingId: listing.id,
    listingSlug: listing.slug,
    listingTitle: data.title,
    listingHeroImageUrl: data.heroUrl,
    category: listing.category as 'private' | 'shared',
    initialDate: date ?? specialEventDate ?? amsterdamToday,
    initialGuests: guests ? Number(guests) : undefined,
    initialTime: time,
    // Pride's real policy (full refund up to 3 weeks out, then none) is shown
    // in full via the Cancellation Policy card — the blanket "Free cancellation"
    // sidebar badge reads as a looser promise than that, so it's dropped here.
    cancellationPolicy: isSpecialEvent ? null : data.cancellationPolicy,
    cancellationTiers: data.cancellationTiers,
    startingPrice: listing.starting_price ?? null,
    maxGuests: listing.max_guests ?? null,
    minPartyOverride,
    offeredBoatIds,
    rainbowBoatCard: isSpecialEvent,
    fixedDate: specialEventDate,
    infoPills: [
      ...(listing.duration_display ? [{ icon: 'duration' as const, label: listing.duration_display }] : []),
      ...(listing.max_guests ? [{ icon: 'guests' as const, label: `Up to ${listing.max_guests} guests` }] : []),
      { icon: 'category' as const, label: listing.category === 'private' ? t('private') : t('shared') },
    ],
  }

  // Build LCP preload props for the hero image (only when asset is processed)
  const heroPreload = data.heroAsset && data.heroAsset.status === 'complete' && data.heroAsset.variants?.length
    ? buildHeroPreload(data.heroAsset.variants)
    : null

  return (
    <>
      <TrackPageView event="view_cruise_detail" metadata={{ slug, category: listing.category }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {faqJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      )}
      {/* LCP preload: tells the browser to fetch the hero AVIF before parsing the rest of the HTML.
          Typically saves 200-500ms on Largest Contentful Paint. React 19 hoists <link> to <head>. */}
      {heroPreload && (
        <link
          rel="preload"
          as="image"
          imageSrcSet={heroPreload.srcSet}
          imageSizes={heroPreload.sizes}
          type="image/avif"
          // fetchPriority="high" signals to the browser that this is the LCP
          // resource and should be fetched at the highest network priority,
          // ahead of other preloads (fonts, scripts).
          fetchPriority="high"
        />
      )}

      <StickyBookingHeader title={data.title} priceDisplay={listing.price_display} />
      <MobileBookingCTA rainbowTheme={isSpecialEvent} />
      {/* Pride-only easter egg: a rainbow ribbon trails the cursor on this one listing. */}
      {slug === 'pride-amsterdam-2026' && <RainbowCursorTrail />}

      <div className="min-h-screen bg-texture-sand pb-32 lg:pb-0">

        {/* ── Hero ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 pb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">{listing.category}</span>
          <h1 className={`text-2xl sm:text-4xl font-black mt-2 uppercase ${isSpecialEvent ? 'text-rainbow-gradient' : 'text-[var(--color-primary)]'}`}>{data.title}</h1>
          {data.tagline && <p className="text-[var(--color-muted)] mt-1 text-sm sm:text-base">{data.tagline}</p>}

          {data.avgRating && data.totalReviews > 0 && (() => {
            const avg = Number(data.avgRating)
            const label = avg >= 4.9 ? 'Exceptional' : avg >= 4.5 ? 'Excellent' : avg >= 4 ? 'Very good' : avg >= 3.5 ? 'Good' : 'Nice'
            return (
              <div className="flex items-center gap-2 mt-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-primary)] text-white font-bold text-sm">{data.avgRating}</span>
                <div className="flex flex-col">
                  <span className="text-sm">
                    <span className="font-bold text-[var(--color-ink)]">{label}</span>
                    <span className="text-[var(--color-muted)]"> &middot; {data.totalReviews} reviews</span>
                  </span>
                  <a href="#reviews" className="text-sm text-[var(--color-primary)] font-medium hover:underline">See all reviews</a>
                </div>
              </div>
            )
          })()}
        </div>

        {/* ── Gallery ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/*
            Use totalReviews — the COMBINED Google + TripAdvisor count (e.g. 97) —
            so the popover + gallery modal match the header "Exceptional · 97 reviews",
            not data.reviewCount which only counts the rows we fetched.
          */}
          <ImageGallery images={data.images} heroUrl={data.heroUrl} heroAsset={data.heroAsset} videoUrl={data.videoUrl} title={data.title} reviews={data.serializedReviews} reviewCount={data.totalReviews ?? undefined} avgRating={data.avgRating != null ? Number(data.avgRating) : undefined} />
        </div>

        {/* ── Inline booking (mobile/tablet) ── */}
        <div id="booking" className="lg:hidden max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-8">
          {renderStartCruisingHeader()}
          <BookingPanel {...bookingPanelProps} layout="inline" />
          {isSpecialEvent && <PrideEventWhatsAppCard />}
        </div>

        {/* ── Content + desktop sidebar ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <CruiseContentSections
              highlights={data.highlights}
              description={data.description}
              serializedFood={data.serializedFood}
              serializedDrinks={data.serializedDrinks}
              cancellationTiers={data.cancellationTiers}
              listingBoats={data.listingBoats}
              serializedReviews={data.serializedReviews}
              totalReviews={data.totalReviews}
              listing={listing}
              faqs={data.faqs}
              loc={data.loc}
              faqLabel={t('faq')}
              isSpecialEvent={isSpecialEvent}
              mapCoords={specialEvent?.mapCoords}
            />

            {/* Desktop sidebar — date/guests card scrolls with the page;
                the time/booking card (+ the "Start Cruising" heading) sticks
                together as one unified block once the top card scrolls off. */}
            <div className="hidden lg:block lg:col-span-1">
              <BookingPanel
                {...bookingPanelProps}
                layout="sidebar"
                sidebarHeader={renderStartCruisingHeader()}
              />
              {isSpecialEvent && <PrideEventWhatsAppCard />}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}


/** Build a JSON-LD ImageObject from the optimised hero asset (or legacy URL). */
// Build the hero ImageObject (JSON-LD) from the asset already fetched in
// getCruisePageData — avoids a redundant image_assets query on every render.
// Logic mirrors the previous getCruiseHeroImageObject exactly.
function buildCruiseHeroImageObject(
  heroAsset: ImageAsset | null,
  heroImageUrl: string | null,
  alt: string,
) {
  if (heroAsset && heroAsset.status === 'complete') {
    const variants = (heroAsset.variants as Array<{ width: number; avif_url: string; webp_url: string }>) ?? []
    const largest = variants[variants.length - 1]
    const altText = (heroAsset.alt_text as Record<string, string> | null)?.en ?? alt
    return {
      '@type': 'ImageObject',
      url: largest?.webp_url ?? heroImageUrl,
      width: heroAsset.original_width ?? undefined,
      height: heroAsset.original_height ?? undefined,
      name: altText,
    }
  }
  return heroImageUrl
    ? { '@type': 'ImageObject', url: heroImageUrl, name: alt }
    : null
}


/** Build srcSet + sizes for an LCP <link rel="preload"> tag for the cruise hero. */
function buildHeroPreload(variants: Array<{ width: number; avif_url: string }>) {
  const sorted = variants.slice().sort((a, b) => a.width - b.width)
  const srcSet = sorted.map(v => `${v.avif_url} ${v.width}w`).join(", ")
  return { srcSet, sizes: "(max-width: 1024px) 100vw, 50vw" }
}
