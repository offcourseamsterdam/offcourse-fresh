import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
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
  const supabase = await createClient()

  const { data } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('is_published', true)
    .order('display_order', { ascending: true })

  const listings = (data as CruiseListing[] | null) ?? []
  const loc = locale as Locale

  const { private: privateListings, shared: sharedListings } = categorizeListings(listings)

  return (
    <div className="min-h-screen bg-[var(--color-sand)]">
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
                <CruiseCard key={listing.id} listing={listing} locale={loc} />
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
                <CruiseCard key={listing.id} listing={listing} locale={loc} />
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

function CruiseCard({ listing, locale }: { listing: CruiseListing; locale: Locale }) {
  const title = getLocalizedField(listing, 'title', locale)
  const tagline = getLocalizedField(listing, 'tagline', locale)

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
          <div className="absolute top-3 left-3">
            <span className="bg-white/90 backdrop-blur-sm text-[var(--color-primary)] text-xs font-semibold px-2.5 py-1 rounded-full capitalize">
              {listing.category}
            </span>
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
