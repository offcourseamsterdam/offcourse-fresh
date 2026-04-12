import { getTranslations } from 'next-intl/server'
import { ReviewCard } from '@/components/ui/ReviewCard'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import type { Database } from '@/lib/supabase/types'
import type { Locale } from '@/lib/i18n/config'

type Review = Database['public']['Tables']['social_proof_reviews']['Row']

interface CruiseReviewsProps {
  reviews: Review[]
  locale: Locale
}

export async function CruiseReviews({ reviews, locale }: CruiseReviewsProps) {
  const t = await getTranslations('home.reviews')

  if (reviews.length === 0) return null

  return (
    <section>
      <h2 className="text-xl font-bold text-[var(--color-primary)] mb-4">
        {t('title')}
      </h2>
      <div className="space-y-4">
        {reviews.map(review => (
          <ReviewCard
            key={review.id}
            variant="compact"
            reviewerName={review.reviewer_name}
            reviewText={getLocalizedField(review, 'review_text', locale)}
            rating={review.rating}
            source={review.source}
            authorPhotoUrl={review.author_photo_url}
          />
        ))}
      </div>
    </section>
  )
}
