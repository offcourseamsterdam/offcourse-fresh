import { getTranslations } from 'next-intl/server'
import { ReviewCard } from '@/components/ui/ReviewCard'
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

  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-black text-[var(--color-primary)] text-center mb-12">
          {t('title')}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reviews.map(review => (
            <ReviewCard
              key={review.id}
              reviewerName={review.reviewer_name}
              reviewText={getLocalizedField(review, 'review_text', locale)}
              rating={review.rating}
              source={review.source}
              authorPhotoUrl={review.author_photo_url}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
