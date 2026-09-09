import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import { getAllCruiseAvailabilitySnapshots } from '@/lib/fareharbor/get-availability-snapshot'
import type { CruiseAvailabilitySnapshot } from '@/lib/fareharbor/sync-availability'
import type { Locale } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'
import { categorizeListings } from '@/lib/utils'

type CruiseListing = Database['public']['Tables']['cruise_listings']['Row']

export const revalidate = 60

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'cruises' })
  return {
    title: `${t('pageTitle')} — Off Course Amsterdam`,
    description: t('pageSubtitle'),
  }
}

export default async function CruisesPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('cruises')
  // Cookie-less client — reading cookies() here would force this page dynamic
  // and silently defeat the `revalidate = 60` ISR cache above.
  const supabase = createAdminClient()

  // Narrowed from select('*') — this page only ever renders these columns (see
  // CruiseCard below). All 7 locale variants of title/tagline stay: which one
  // is needed depends on the request's locale, so none is statically prunable.
  const { data } = await supabase
    .from('cruise_listings')
    .select(`
      id, slug, category, hero_image_url, price_display, price_label,
      title, title_de, title_es, title_fr, title_nl, title_pt, title_zh,
      tagline, tagline_de, tagline_es, tagline_fr, tagline_nl, tagline_pt, tagline_zh
    `)
    .eq('is_published', true)
    .eq('is_listed', true)
    .order('display_order', { ascending: true })

  const listings = (data as CruiseListing[] | null) ?? []
  const loc = locale as Locale
  const snapshotMap = await getAllCruiseAvailabilitySnapshots()

  const { private: privateListings, shared: sharedListings } = categorizeListings(listings)

  // Schema.org ItemList for search engine & LLM crawler indexing
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Off Course Amsterdam Boat Tours & Canal Cruises',
    description: 'Private boat tours and shared canal cruises in Amsterdam with open bar, local skippers, and salon boats.',
    itemListElement: listings.map((listing, index) => {
      const title = getLocalizedField(listing, 'title', loc)
      const snap = snapshotMap.get(listing.id)
      return {
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'TouristTrip',
          name: title,
          description: getLocalizedField(listing, 'tagline', loc),
          url: `https://offcourseamsterdam.com/${loc}/cruises/${listing.slug}`,
          touristType: listing.category === 'private' ? 'Private Group Charter' : 'Shared Small Group Tour',
          offers: {
            '@type': 'Offer',
            price: listing.starting_price ?? undefined,
            priceCurrency: 'EUR',
            availability: snap?.next_available_slot ? 'https://schema.org/InStock' : 'https://schema.org/InStoreOnly',
          },
        },
      }
    }),
  }

  return (
    <div className="min-h-screen bg-[var(--color-sand)]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Header */}
      <div className="bg-[var(--color-primary)] text-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">{t('pageTitle')}</h1>
          <p className="text-white/70 text-lg max-w-xl mx-auto">{t('pageSubtitle')}</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">

        {/* Private cruises */}
        {privateListings.length > 0 && (
          <section>
            <div className="mb-8">
              <h2 className="text-2xl font-black text-[var(--color-primary)]">
                Private cruises
              </h2>
              <p className="text-[var(--color-muted)] mt-1 text-sm">
                The whole boat, just your group. You pick the vibe.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {privateListings.map(listing => (
                <CruiseCard
                  key={listing.id}
                  listing={listing}
                  locale={loc}
                  snapshot={snapshotMap.get(listing.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Shared cruises */}
        {sharedListings.length > 0 && (
          <section>
            <div className="mb-8">
              <h2 className="text-2xl font-black text-[var(--color-primary)]">
                Shared cruises
              </h2>
              <p className="text-[var(--color-muted)] mt-1 text-sm">
                Meet cool people. Pay per person. Amsterdam from the water.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {sharedListings.map(listing => (
                <CruiseCard
                  key={listing.id}
                  listing={listing}
                  locale={loc}
                  snapshot={snapshotMap.get(listing.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {listings.length === 0 && (
          <div className="text-center py-24">
            <p className="text-[var(--color-muted)] text-lg">
              Cruises coming soon. Check back shortly.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Card component ────────────────────────────────────────────────────────────

function CruiseCard({
  listing,
  locale,
  snapshot,
}: {
  listing: CruiseListing
  locale: Locale
  snapshot?: CruiseAvailabilitySnapshot
}) {
  const title = getLocalizedField(listing, 'title', locale)
  const tagline = getLocalizedField(listing, 'tagline', locale)
  const nextDay = snapshot?.upcoming_days?.[0]
  const nextSlot = nextDay?.slots?.[0]

  return (
    <Link href={`/cruises/${listing.slug}`} className="group block">
      <article className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200 h-full flex flex-col">
        {/* Image */}
        <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-sand)]">
          {listing.hero_image_url ? (
            <Image
              src={listing.hero_image_url}
              alt={title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/20 to-[var(--color-primary)]/5 flex items-center justify-center">
              <span className="text-4xl font-black text-[var(--color-primary)]/20">OC</span>
            </div>
          )}
          <div className="absolute top-3 left-3 flex items-center gap-1.5">
            <span className="bg-white/90 backdrop-blur-sm text-[var(--color-primary)] text-xs font-semibold px-2.5 py-1 rounded-full capitalize">
              {listing.category}
            </span>
            {nextSlot && (
              <span className="bg-emerald-600/90 text-white backdrop-blur-sm text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {nextDay.formattedDate.split(' ')[0]} {nextSlot.startTime}
              </span>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="p-5 flex flex-col flex-1">
          <h3 className="font-bold text-[var(--color-primary)] text-base mb-1 group-hover:underline">
            {title}
          </h3>
          {tagline && (
            <p className="text-sm text-[var(--color-muted)] mb-4 line-clamp-2 flex-1">
              {tagline}
            </p>
          )}

          <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-100">
            {listing.price_display ? (
              <div>
                <span className="text-xs text-[var(--color-muted)]">From</span>
                <p className="font-bold text-[var(--color-primary)]">{listing.price_display}</p>
                {listing.price_label && (
                  <span className="text-xs text-[var(--color-muted)]">{listing.price_label}</span>
                )}
              </div>
            ) : (
              <span />
            )}
            <span className="text-xs font-semibold text-[var(--color-accent)] uppercase tracking-wide">
              View →
            </span>
          </div>
        </div>
      </article>
    </Link>
  )
}
