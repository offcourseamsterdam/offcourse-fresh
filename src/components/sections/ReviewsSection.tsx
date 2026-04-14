import { getTranslations } from 'next-intl/server'
import { ReviewsSlider } from '@/components/sections/ReviewsSlider'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import type { Database } from '@/lib/supabase/types'
import type { Locale } from '@/lib/i18n/config'

type Review = Database['public']['Tables']['social_proof_reviews']['Row']

interface ReviewsSectionProps {
  reviews: Review[]
  locale: Locale
}

export async function ReviewsSection({ reviews, locale }: ReviewsSectionProps) {
  const t = await getTranslations('home.reviews')

  if (reviews.length === 0) return null

  // Shape reviews for the client slider (localize text + pick only needed fields)
  const sliderReviews = reviews.map(r => ({
    id: r.id,
    reviewer_name: r.reviewer_name,
    review_text: getLocalizedField(r, 'review_text', locale),
    rating: r.rating,
    source: r.source,
    author_photo_url: r.author_photo_url,
    publish_time: r.publish_time,
  }))

  return (
    <section className="bg-[var(--color-sand)] py-16 sm:py-20 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="text-center mb-10">
          <h2 className="font-palmore text-4xl sm:text-5xl text-[var(--color-primary)] mb-3">
            {t('title')}
          </h2>
          <p className="font-avenir text-sm text-[var(--color-muted)]">
            {reviews.length}+ verified reviews
          </p>
        </div>

        {/* Slider (client component) */}
        <ReviewsSlider reviews={sliderReviews} />
      </div>
    </section>
  )
}
