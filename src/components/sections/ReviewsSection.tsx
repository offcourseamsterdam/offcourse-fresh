import { getTranslations } from 'next-intl/server'
import { ReviewsSlider } from '@/components/sections/ReviewsSlider'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import type { Database } from '@/lib/supabase/types'
import type { Locale } from '@/lib/i18n/config'

type Review = Database['public']['Tables']['social_proof_reviews']['Row']

interface ReviewsSectionProps {
  reviews: Review[]
  /** Total Google review count — defaults to the synced review count when not provided. */
  totalReviewCount?: number
  locale: Locale
  googlePlaceId?: string | null
  tripadvisorUrl?: string | null
}

export async function ReviewsSection({
  reviews,
  totalReviewCount,
  locale,
  googlePlaceId,
  tripadvisorUrl,
}: ReviewsSectionProps) {
  const t = await getTranslations('home.reviews')

  if (reviews.length === 0) return null
  const displayCount = totalReviewCount ?? reviews.length

  // Shape reviews for the client slider (localize text + pick only needed fields)
  const sliderReviews = reviews.map(r => ({
    id: r.id,
    reviewer_name: r.reviewer_name,
    review_text: getLocalizedField(r, 'review_text', locale),
    rating: r.rating,
    source: r.source,
    author_photo_url: r.author_photo_url,
    review_image_url: r.review_image_url,
    publish_time: r.publish_time,
  }))

  const hasGoogle = reviews.some(r => r.source === 'google')
  const hasTa = reviews.some(r => r.source === 'tripadvisor')

  // "See all reviews" deep links to the real source profiles (the ones that actually rank).
  const googleReviewsUrl = googlePlaceId
    ? `https://search.google.com/local/reviews?placeid=${encodeURIComponent(googlePlaceId)}`
    : null

  return (
    <section className="bg-[var(--color-sand)] py-16 sm:py-20 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="text-center mb-10">
          <h2 className="font-palmore text-4xl sm:text-5xl text-[var(--color-primary)] mb-3">
            {t('title')}
          </h2>
          <p className="font-avenir text-sm text-[var(--color-muted)]">
            {displayCount}+ verified reviews
          </p>
        </div>

        {/* Slider (client component) — shows source tabs only when both sources present */}
        <ReviewsSlider reviews={sliderReviews} showSourceTabs={hasGoogle && hasTa} />

        {/* See all on the source platforms (the profiles that rank in search) */}
        {(googleReviewsUrl || tripadvisorUrl) && (
          <div className="text-center mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-avenir">
            {googleReviewsUrl && (
              <a
                href={googleReviewsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline"
              >
                See all reviews on Google →
              </a>
            )}
            {tripadvisorUrl && (
              <a
                href={tripadvisorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline"
              >
                See all on TripAdvisor →
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
