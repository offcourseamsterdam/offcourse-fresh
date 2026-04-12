import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import { CategoryBadge } from '@/components/ui/CategoryBadge'
import { categorizeListings } from '@/lib/utils'

type CruiseListing = Database['public']['Tables']['cruise_listings']['Row']

interface FeaturedCruisesProps {
  listings: CruiseListing[]
  locale: Locale
}

export async function FeaturedCruises({ listings, locale }: FeaturedCruisesProps) {
  const t = await getTranslations('home.featured')

  // Prefer one private + one shared; fall back to first 2
  const { private: privateListings, shared: sharedListings } = categorizeListings(listings)
  const first = privateListings[0] ?? listings[0]
  const second = sharedListings[0] ?? listings.find(l => l.id !== first?.id)
  const displayListings = [first, second].filter(Boolean) as CruiseListing[]

  return (
    <section className="bg-texture-lavender min-h-screen flex items-center justify-center pt-60 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-12">
          <h2 className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] text-accent leading-none mb-3">
            OFF THE BEATEN CANAL
          </h2>
          <p className="font-palmore text-[32px] sm:text-[40px] text-primary leading-tight">
            we drift different
          </p>
        </div>

        {/* Cruise cards */}
        {displayListings.length === 0 ? (
          <div className="text-center">
            <Link href="/cruises"
              className="inline-block bg-cta text-accent border-2 border-accent rounded-full px-8 py-4 font-palmore text-lg hover:bg-accent hover:text-cta transition-all duration-300">
              Browse all cruises
            </Link>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-8 justify-center items-start">
            {displayListings.map((listing) => {
              const title = getLocalizedField(listing, 'title', locale)
              const description = getLocalizedField(listing, 'description', locale)
              const isPrivate = listing.category === 'private'

              return (
                <div key={listing.id} className="bg-white p-6 pb-8 shadow-2xl w-full sm:w-80 flex-shrink-0">
                  <div className="mb-3">
                    <CategoryBadge isPrivate={isPrivate} />
                  </div>

                  {/* Photo */}
                  <div className="relative aspect-[4/3] overflow-hidden bg-[#e5e7eb] mb-4">
                    {listing.hero_image_url ? (
                      <Image
                        src={listing.hero_image_url}
                        alt={title}
                        fill
                        sizes="320px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5" />
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="font-avenir font-bold text-ink text-lg mb-2 leading-tight">{title}</h3>

                  {/* Description */}
                  {description && (
                    <p className="font-avenir text-muted text-sm leading-relaxed mb-4 line-clamp-3">
                      {description}
                    </p>
                  )}

                  {/* Price */}
                  {listing.price_display && (
                    <p className="font-avenir font-bold text-primary text-base mb-1">{listing.price_display}</p>
                  )}
                  {/* CTAs */}
                  <div className="flex gap-3">
                    <Link
                      href={`/cruises/${listing.slug}`}
                      className="flex-1 bg-cta text-accent border-2 border-accent rounded-full py-2.5 font-palmore text-sm text-center hover:bg-accent hover:text-cta transition-all duration-300"
                    >
                      Book
                    </Link>
                    <Link
                      href={`/cruises/${listing.slug}`}
                      className="flex-1 bg-transparent text-primary border-2 border-primary rounded-full py-2.5 font-avenir text-sm text-center hover:bg-primary hover:text-white transition-all duration-300"
                    >
                      More Info
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
