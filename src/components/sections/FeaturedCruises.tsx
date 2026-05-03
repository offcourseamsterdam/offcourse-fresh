'use client'

import { Link } from '@/i18n/navigation'
import { CategoryBadge } from '@/components/ui/CategoryBadge'
import { OptimizedImage } from '@/components/ui/OptimizedImage'
import { useSearch } from '@/lib/search/SearchContext'
import type { Database } from '@/lib/supabase/types'
import type { AvailabilitySlot } from '@/types'
import type { ImageAsset } from '@/lib/images/types'

type CruiseListingRow = Database['public']['Tables']['cruise_listings']['Row']

export type FeaturedCruiseListing = Pick<
  CruiseListingRow,
  'id' | 'slug' | 'category' | 'hero_image_url' | 'title' | 'tagline' | 'price_display' | 'duration_display'
> & {
  /** Optional optimized hero asset — when present, served as AVIF/WebP. */
  hero_asset?: ImageAsset | null
}

// ── Date formatting ──────────────────────────────────────────────────────────

function formatSearchDate(dateStr: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T12:00:00')
  target.setHours(0, 0, 0, 0)

  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'

  return target.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).replace(',', ' the')
}

// ── Skeleton for time slot pills ─────────────────────────────────────────────

function TimeSlotSkeleton() {
  return (
    <div className="flex gap-2 mt-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-7 w-14 rounded-full bg-zinc-200 animate-pulse" />
      ))}
    </div>
  )
}

// ── Time slot pills ──────────────────────────────────────────────────────────

function TimeSlotPills({ slots, slug, date, guests }: {
  slots: AvailabilitySlot[]
  slug: string
  date: string
  guests: number
}) {
  if (slots.length === 0) {
    return (
      <p className="font-avenir text-xs text-muted mt-3 italic">
        No departures available
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {slots.slice(0, 5).map(slot => (
        <Link
          key={slot.startTime}
          href={`/cruises/${slug}?date=${date}&guests=${guests}&time=${slot.startTime}`}
          className="font-avenir text-xs bg-sand text-primary font-medium px-3 py-1.5 rounded-full hover:bg-primary hover:text-white transition-colors duration-150"
        >
          {slot.startTime}
        </Link>
      ))}
      {slots.length > 5 && (
        <span className="font-avenir text-xs text-muted font-medium px-2 py-1.5">
          +{slots.length - 5} more
        </span>
      )}
    </div>
  )
}

// ── Polaroid cruise card ─────────────────────────────────────────────────────

function CruiseCard({ listing, rotation, slots, loading, date, guests }: {
  listing: FeaturedCruiseListing
  rotation: string
  slots?: AvailabilitySlot[]
  loading: boolean
  date: string | null
  guests: number
}) {
  const isPrivate = listing.category === 'private'

  return (
    <div className={`w-full sm:w-80 flex-shrink-0 ${rotation} transition-transform hover:rotate-0 duration-300`}>
      {/* Polaroid frame */}
      <div className="bg-white p-4 pb-3 shadow-polaroid">
        {/* Image with badge */}
        <div className="relative aspect-[4/3] overflow-hidden bg-[#e5e7eb] mb-3">
          {listing.hero_image_url ? (
            <OptimizedImage
              asset={listing.hero_asset}
              fallbackUrl={listing.hero_image_url}
              alt={listing.title ?? ''}
              context="card"
              fill
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5" />
          )}
          <div className="absolute top-3 right-3">
            <CategoryBadge isPrivate={isPrivate} />
          </div>
        </div>

        {/* Title inside polaroid */}
        <h3 className="font-avenir font-bold text-ink text-lg leading-tight text-center">
          {listing.title}
        </h3>
      </div>

      {/* Below polaroid — tagline, price, buttons (white Verdana text on lavender bg) */}
      <div className="text-center mt-4 px-2" style={{ fontFamily: 'Verdana, Geneva, sans-serif' }}>
        {listing.tagline && (
          <p className="text-white text-base leading-relaxed mb-3 italic">
            {listing.tagline}
          </p>
        )}

        {/* Price */}
        {listing.price_display && (
          <p className="font-bold text-white text-xl mb-0.5">{listing.price_display}</p>
        )}
        {listing.duration_display && (
          <p className="text-white/70 text-xs mb-4">{listing.duration_display}</p>
        )}

        {/* CTAs */}
        <div className="flex gap-3 justify-center">
          <Link
            href={date ? `/cruises/${listing.slug}?date=${date}&guests=${guests}` : `/cruises/${listing.slug}`}
            className="flex-1 max-w-[140px] border-2 border-accent text-accent rounded-full py-2 font-palmore text-sm text-center hover:bg-accent hover:text-white transition-all duration-300"
          >
            Book
          </Link>
          <Link
            href={`/cruises/${listing.slug}`}
            className="flex-1 max-w-[140px] border-2 border-white text-white py-2 font-avenir text-sm text-center hover:bg-white hover:text-primary transition-all duration-300"
          >
            More Info
          </Link>
        </div>

        {/* Time slots — only visible after search */}
        {date && (
          <div className="mt-3 pb-2">
            {loading ? (
              <TimeSlotSkeleton />
            ) : slots ? (
              <TimeSlotPills slots={slots} slug={listing.slug} date={date} guests={guests} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main section ─────────────────────────────────────────────────────────────

interface FeaturedCruisesProps {
  listings: FeaturedCruiseListing[]
}

export function FeaturedCruises({ listings }: FeaturedCruisesProps) {
  const { searchDate, searchGuests, searchLoading, searchResults } = useSearch()

  // Prefer one private + one shared; fall back to first 2
  const privateListings = listings.filter(l => l.category === 'private')
  const sharedListings = listings.filter(l => l.category === 'shared')
  const first = privateListings[0] ?? listings[0]
  const second = sharedListings[0] ?? listings.find(l => l.id !== first?.id)
  const displayListings = [first, second].filter(Boolean) as FeaturedCruiseListing[]

  const rotations = ['-rotate-2', 'rotate-2']

  // Find slots for a given listing
  function getSlotsForListing(listingId: string): AvailabilitySlot[] | undefined {
    const result = searchResults.find(r => r.listingId === listingId)
    return result?.slots
  }

  return (
    <section id="cruise-results" className="bg-texture-lavender min-h-screen flex items-center justify-center pt-60 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-12">
          <h2 className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] text-accent leading-none mb-3">
            OFF THE BEATEN CANAL
          </h2>
          <p className="font-palmore text-[32px] sm:text-[40px] text-primary leading-tight">
            we drift different
          </p>

          {/* Date label — shown after search */}
          {searchDate && (
            <p className="font-avenir text-sm text-muted mt-4">
              Showing availability for <span className="font-bold text-ink">{formatSearchDate(searchDate)}</span>
            </p>
          )}
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
          <div className="flex flex-col sm:flex-row gap-12 justify-center items-start">
            {displayListings.map((listing, i) => (
              <CruiseCard
                key={listing.id}
                listing={listing}
                rotation={rotations[i % rotations.length]}
                slots={getSlotsForListing(listing.id)}
                loading={searchLoading}
                date={searchDate}
                guests={searchGuests}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
