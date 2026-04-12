import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { StarRating } from '@/components/ui/StarRating'
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
        {reviews.map(review => {
          const text = getLocalizedField(review, 'review_text', locale)
          return (
            <article
              key={review.id}
              className="bg-[var(--color-sand)] rounded-xl p-5 flex flex-col gap-2"
            >
              <div className="flex items-center gap-3">
                {review.author_photo_url ? (
                  <Image
                    src={review.author_photo_url}
                    alt={review.reviewer_name}
                    width={28}
                    height={28}
                    className="w-7 h-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-xs font-semibold">
                    {review.reviewer_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="font-semibold text-sm text-[var(--color-primary)]">
                  {review.reviewer_name}
                </span>
                <StarRating rating={review.rating} className="ml-auto" />
              </div>
              <blockquote className="text-sm text-[var(--color-foreground)] leading-relaxed">
                &ldquo;{text}&rdquo;
              </blockquote>
              {review.source && (
                <span className="text-xs text-[var(--color-muted)] capitalize">
                  {review.source}
                </span>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
