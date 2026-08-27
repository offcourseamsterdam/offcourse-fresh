import Image from 'next/image'
import { Check } from 'lucide-react'
import { ExtrasGrid } from './ExtrasGrid'
import { CancellationPolicyCard } from './CancellationPolicyCard'
import { ReviewSlider } from './ReviewSlider'
import { BoatCard } from './BoatCard'
import { FoodHostCard } from './FoodHostCard'
import { TruncatedDescription } from './TruncatedDescription'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import type { Locale } from '@/lib/i18n/config'
import type { CancellationTier } from '@/lib/cancellation/policy'

type SerializedExtra = { id: string; name: string; description: string | null; image_url: string | null; ingredients: string[] | null; price_display: string; min_people: number | null; default_to_guest_count: boolean }

interface ContentProps {
  highlights: { text: string }[]
  description: string | null
  serializedFood: SerializedExtra[]
  serializedDrinks: SerializedExtra[]
  cancellationTiers: CancellationTier[]
  listingBoats: { id: string; name: string; max_capacity: number | null; is_electric: boolean | null; description: string | null; photo_url: string | null; photo_covered_url: string | null; photo_interior_url: string | null }[]
  serializedReviews: { id: string; reviewer_name: string; review_text: string; rating: number; source: string | null; author_photo_url: string | null; review_image_url: string | null; publish_time: string | null }[]
  totalReviews?: number
  listing: {
    departure_location: string | null
    google_maps_url: string | null
    chef_name?: string | null
    chef_bio?: string | null
    chef_photo_url?: string | null
  }
  faqs: { question: string; answer: string }[]
  loc: Locale
  faqLabel: string
  /**
   * Fixed-date special events (Pride, etc.) already bake unlimited drinks into
   * the price, so the pay-per-item food/drinks upsell grid doesn't apply — an
   * "open bar included" card replaces it instead. Also drives the rainbow
   * heading treatment used throughout these event pages.
   */
  isSpecialEvent?: boolean
  /** "lat,lng" for a listing whose meeting point differs from the default dock — renders an actual embedded map, not just a link out. */
  mapCoords?: string
}

// Placeholder until a Pride-specific shot is uploaded — swap via the listing's
// photo manager once available.
const OPEN_BAR_IMAGE_URL = 'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/c419659a-a021-42ef-bfb7-77bde2a0a82a/friends-on-a-boat-amsterdam-canals-chill-canal-electric_800.webp'

const headingClass = (isSpecialEvent: boolean | undefined, extra = '') =>
  `font-briston text-[28px] sm:text-[36px] uppercase ${extra} ${
    isSpecialEvent ? 'text-rainbow-gradient' : 'text-[var(--color-accent)]'
  }`

export function CruiseContentSections({
  highlights, description, serializedFood, serializedDrinks,
  cancellationTiers, listingBoats, serializedReviews, totalReviews,
  listing, faqs, loc, faqLabel, isSpecialEvent, mapCoords,
}: ContentProps) {
  return (
    <div className="lg:col-span-2 space-y-10">
      {/* Highlights */}
      {highlights.length > 0 && (
        <section>
          <h2 className={`text-xl font-bold mb-4 ${isSpecialEvent ? 'text-rainbow-gradient-static' : 'text-[var(--color-primary)]'}`}>Highlights</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2.5">
                {isSpecialEvent ? (
                  <span className="mt-0.5 flex-shrink-0 w-5 h-5 flex items-center justify-center text-sm leading-none" aria-hidden="true">
                    🌈
                  </span>
                ) : (
                  <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </span>
                )}
                <span className="text-sm text-[var(--color-ink)]">{h.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Description */}
      {description && (
        <TruncatedDescription html={description} maxLength={500} />
      )}

      {/* Things you need to know — special events already include an open bar
          in the price, so the pay-per-item food/drinks upsell doesn't apply. */}
      {isSpecialEvent ? (
        <section>
          <h2 className={headingClass(isSpecialEvent, 'mb-6')}>Things you need to know</h2>
          <div className="rounded-2xl overflow-hidden bg-white shadow-sm border border-zinc-100 flex flex-col sm:flex-row">
            <div className="relative w-full sm:w-64 h-48 sm:h-auto flex-shrink-0">
              <Image src={OPEN_BAR_IMAGE_URL} alt="Open bar included" fill className="object-cover" sizes="256px" />
            </div>
            <div className="p-6 flex flex-col justify-center">
              <h3 className="font-avenir font-bold text-lg text-[var(--color-primary)] mb-1">Open bar included</h3>
              <p className="text-sm text-[var(--color-ink)]">
                Unlimited beer, wine, and sodas are already baked into your price — nothing extra to buy on board, just show up and drink.
              </p>
            </div>
          </div>
          {cancellationTiers.length > 0 && (
            <div className="mt-3">
              <CancellationPolicyCard tiers={cancellationTiers} isSpecialEvent={isSpecialEvent} />
            </div>
          )}
        </section>
      ) : (
        (serializedFood.length > 0 || serializedDrinks.length > 0 || cancellationTiers.length > 0) && (
          <section>
            <h2 className={headingClass(isSpecialEvent, 'mb-6')}>Things you need to know</h2>
            <ExtrasGrid foodExtras={serializedFood} drinkExtras={serializedDrinks} cancellationTiers={cancellationTiers} />
          </section>
        )
      )}

      {/* Our boats — a single-boat listing with a chef/food host set (the
          "private food cruise" pattern, e.g. the Curaçao Jamaican Buffet Cruise)
          gets a "The Boat" / "The Food" split instead of the generic boat grid. */}
      {listingBoats.length > 0 && (
        listingBoats.length === 1 && listing.chef_name ? (
          <section>
            <h2 className={headingClass(isSpecialEvent, 'mb-6')}>The boat &amp; the food</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">The Boat</h3>
                <BoatCard
                  name={listingBoats[0].name}
                  maxCapacity={listingBoats[0].max_capacity}
                  isElectric={listingBoats[0].is_electric ?? false}
                  description={getLocalizedField(listingBoats[0], 'description', loc) || null}
                  photoUrl={listingBoats[0].photo_url}
                  photoCoveredUrl={listingBoats[0].photo_covered_url}
                  photoInteriorUrl={listingBoats[0].photo_interior_url}
                />
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">The Food</h3>
                <FoodHostCard
                  name={listing.chef_name}
                  bio={listing.chef_bio ?? null}
                  photoUrl={listing.chef_photo_url ?? null}
                />
              </div>
            </div>
          </section>
        ) : (
          <section>
            <h2 className={headingClass(isSpecialEvent, 'mb-6')}>Our boats</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {listingBoats.map((boat) => (
                <BoatCard
                  key={boat.id}
                  name={boat.name}
                  maxCapacity={boat.max_capacity}
                  isElectric={boat.is_electric ?? false}
                  description={getLocalizedField(boat, 'description', loc) || null}
                  photoUrl={boat.photo_url}
                  photoCoveredUrl={boat.photo_covered_url}
                  photoInteriorUrl={boat.photo_interior_url}
                />
              ))}
            </div>
          </section>
        )
      )}

      {/* Reviews */}
      {serializedReviews.length > 0 && (
        <section id="reviews">
          <ReviewSlider reviews={serializedReviews} totalReviews={totalReviews} isSpecialEvent={isSpecialEvent} />
        </section>
      )}

      {/* Meeting point */}
      <section>
        <h2 className={headingClass(isSpecialEvent, 'mb-4')}>Where we meet</h2>
        {listing.departure_location && (
          <p className="text-sm text-[var(--color-ink)] mb-3 flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
            {listing.departure_location}
          </p>
        )}
        {mapCoords ? (
          // Listing has its own meeting point, distinct from the default departure
          // dock, and we have resolved coordinates for it — embed a real map (a
          // share link like maps.app.goo.gl doesn't convert into embeddable pb=
          // form on its own, but a plain q=lat,lng embed needs no API key).
          <div className="space-y-2">
            <div className="rounded-xl overflow-hidden shadow-sm aspect-[16/9]">
              <iframe
                src={`https://www.google.com/maps?q=${mapCoords}&output=embed`}
                width="100%" height="100%" style={{ border: 0 }}
                allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                title="Meeting point"
              />
            </div>
            {listing.google_maps_url && (
              <a
                href={listing.google_maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
              >
                Open in Google Maps →
              </a>
            )}
          </div>
        ) : listing.google_maps_url ? (
          // Custom meeting point but no resolved coordinates yet — link out
          // rather than force a broken embed.
          <a
            href={listing.google_maps_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl bg-white border border-zinc-100 shadow-sm p-5 hover:border-[var(--color-primary)] transition-colors"
          >
            <span className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
            </span>
            <span className="flex-1 text-sm font-semibold text-[var(--color-primary)]">Open this meeting point in Google Maps</span>
          </a>
        ) : (
          <div className="rounded-xl overflow-hidden shadow-sm aspect-[16/9]">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2435.4996052156116!2d4.888518977372259!3d52.37949287202471!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47c60937bd90461f%3A0x242f1bc48df48c07!2sOff~Course%20Canal%20Cruises!5e0!3m2!1sen!2snl!4v1776093877188!5m2!1sen!2snl"
              width="100%" height="100%" style={{ border: 0 }}
              allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade"
              title="Off Course Canal Cruises — meeting point"
            />
          </div>
        )}
      </section>

      {/* FAQ */}
      {faqs.length > 0 && (
        <section>
          <h2 className="font-briston text-[28px] sm:text-[36px] text-[var(--color-accent)] uppercase mb-4">{faqLabel}</h2>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <details key={i} className="group border border-gray-100 rounded-xl overflow-hidden bg-white">
                <summary className="flex items-center justify-between p-4 cursor-pointer font-semibold text-[var(--color-primary)] hover:bg-[var(--color-sand)] transition-colors">
                  {faq.question}
                  <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0 transition-transform group-open:rotate-180" fill="currentColor">
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                  </svg>
                </summary>
                <div className="p-4 pt-0 text-[var(--color-ink)] text-sm leading-relaxed border-t border-gray-100">{faq.answer}</div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
