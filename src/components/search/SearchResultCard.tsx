import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { formatPrice } from '@/lib/utils'
import type { SearchResult } from '@/types'
import type { Locale } from '@/lib/i18n/config'
import { CategoryBadge } from '@/components/ui/CategoryBadge'

interface SearchResultCardProps {
  result: SearchResult
  locale: Locale
  date: string
  guests: number
}

export function SearchResultCard({ result, locale, date, guests }: SearchResultCardProps) {
  const href = `/cruises/${result.listing.slug}?date=${date}&guests=${guests}`
  const isPrivate = result.listing.category === 'private'

  return (
    <Link href={href} className="group block">
      <article className="bg-white/90 backdrop-blur-sm shadow-2xl overflow-hidden h-full flex flex-col hover:shadow-xl transition-shadow duration-200">

        {/* Photo */}
        <div className="relative aspect-[4/3] overflow-hidden bg-[#e5e7eb]">
          {result.listing.hero_image_url ? (
            <Image
              src={result.listing.hero_image_url}
              alt={result.listing.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5" />
          )}
          <div className="absolute top-3 left-3">
            <CategoryBadge isPrivate={isPrivate} />
          </div>
        </div>

        <div className="p-5 flex flex-col flex-1">
          <h3 className="font-avenir font-bold text-ink text-base mb-1 leading-tight">
            {result.listing.title}
          </h3>
          {result.listing.tagline && (
            <p className="font-avenir text-sm text-muted mb-3 line-clamp-2">
              {result.listing.tagline}
            </p>
          )}

          {/* Available time slots */}
          <div className="mt-2 mb-4 min-h-[36px]">
            {result.availableSlots.length > 0 ? (
              <>
                <p className="font-avenir font-bold text-[10px] uppercase tracking-widest text-muted mb-2">
                  Departure times
                </p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {result.availableSlots.slice(0, 5).map(slot => (
                    <Link
                      key={slot.startTime}
                      href={`/cruises/${result.listing.slug}?date=${date}&guests=${guests}&time=${slot.startTime}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-avenir text-xs bg-sand text-primary font-medium px-2.5 py-1 rounded-full hover:bg-primary hover:text-white transition-colors duration-150"
                    >
                      {slot.startTime}
                    </Link>
                  ))}
                  {result.availableSlots.length > 5 && (
                    <span className="font-avenir text-xs text-muted font-medium">
                      +{result.availableSlots.length - 5} more
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="font-avenir text-xs text-muted">Check availability on cruise page</p>
            )}
          </div>

          {/* Price + CTA */}
          <div className="flex items-center justify-between mt-auto pt-4 border-t border-[#e5e7eb]">
            <div>
              <span className="font-avenir text-xs text-muted">From</span>
              <p className="font-avenir font-bold text-primary text-base leading-none">
                {result.listing.starting_price
                  ? formatPrice(result.listing.starting_price * 100, locale)
                  : result.listing.price_display ?? '—'}
              </p>
              {result.listing.price_label && (
                <span className="font-avenir text-xs text-muted">{result.listing.price_label}</span>
              )}
            </div>
            <span className="bg-cta text-accent border-2 border-accent rounded-full px-4 py-1.5 font-palmore text-sm group-hover:bg-accent group-hover:text-cta transition-all duration-300">
              Book →
            </span>
          </div>
        </div>
      </article>
    </Link>
  )
}
