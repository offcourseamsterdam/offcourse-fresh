import { Check } from 'lucide-react'
import { ExtrasGrid } from './ExtrasGrid'
import { ReviewSlider } from './ReviewSlider'
import { BoatCard } from './BoatCard'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import type { Locale } from '@/lib/i18n/config'

type SerializedExtra = { id: string; name: string; description: string | null; image_url: string | null; ingredients: string[] | null; price_display: string }

interface ContentProps {
  highlights: { text: string }[]
  description: string | null
  serializedFood: SerializedExtra[]
  serializedDrinks: SerializedExtra[]
  cancellationPolicy: string | null
  listingBoats: { id: string; name: string; max_capacity: number | null; is_electric: boolean | null; description: string | null; photo_url: string | null; photo_covered_url: string | null; photo_interior_url: string | null }[]
  serializedReviews: { id: string; reviewer_name: string; review_text: string; rating: number; source: string | null; author_photo_url: string | null; publish_time: string | null }[]
  listing: { departure_location: string | null }
  faqs: { question: string; answer: string }[]
  loc: Locale
  faqLabel: string
}

export function CruiseContentSections({
  highlights, description, serializedFood, serializedDrinks,
  cancellationPolicy, listingBoats, serializedReviews,
  listing, faqs, loc, faqLabel,
}: ContentProps) {
  return (
    <div className="lg:col-span-2 space-y-10">
      {/* Highlights */}
      {highlights.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-[var(--color-primary)] mb-4">Highlights</h2>
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
          <h2 className="font-briston text-[28px] sm:text-[36px] text-[var(--color-accent)] uppercase mb-6">
            Things you need to know
          </h2>
          <ExtrasGrid foodExtras={serializedFood} drinkExtras={serializedDrinks} cancellationPolicy={cancellationPolicy} />
        </section>
      )}

      {/* Our boats */}
      {listingBoats.length > 0 && (
        <section>
          <h2 className="font-briston text-[28px] sm:text-[36px] text-[var(--color-accent)] uppercase mb-6">Our boats</h2>
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
      )}

      {/* Reviews */}
      {serializedReviews.length > 0 && (
        <section id="reviews">
          <ReviewSlider reviews={serializedReviews} />
        </section>
      )}

      {/* Meeting point */}
      <section>
        <h2 className="font-briston text-[28px] sm:text-[36px] text-[var(--color-accent)] uppercase mb-4">Where we meet</h2>
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
            width="100%" height="100%" style={{ border: 0 }}
            allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade"
            title="Off Course Canal Cruises — meeting point"
          />
        </div>
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
