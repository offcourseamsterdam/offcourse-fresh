import { getTranslations } from 'next-intl/server'
import { StarRating } from '@/components/ui/StarRating'
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
          {reviews.map(review => {
            const text = getLocalizedField(review, 'review_text', locale)
            return (
              <article key={review.id} className="bg-[var(--color-sand)] rounded-2xl p-6 flex flex-col gap-3">
                <StarRating rating={review.rating} />
                <blockquote className="text-[var(--color-foreground)] text-sm leading-relaxed flex-1">
                  &ldquo;{text}&rdquo;
                </blockquote>
                <footer className="flex items-center justify-between">
                  <p className="font-semibold text-[var(--color-primary)] text-sm">{review.reviewer_name}</p>
                  {review.source && (
                    <span className="text-xs text-[var(--color-muted)] capitalize">{review.source}</span>
                  )}
                </footer>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
