import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { ReviewsSlider } from '@/components/sections/ReviewsSlider'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import type { Database } from '@/lib/supabase/types'
import type { Locale } from '@/lib/i18n/config'
import { sectionRootStyle, roleColor, type SectionStyle } from '@/lib/homepage/section-styles'

// Only the columns we actually select — keeps the type consistent with the
// homepage query which uses .select(specific columns).limit(20) for performance.
type Review = Pick<
  Database['public']['Tables']['social_proof_reviews']['Row'],
  | 'id' | 'reviewer_name' | 'rating' | 'source'
  | 'author_photo_url' | 'review_image_url' | 'publish_time'
  | 'review_text' | 'review_text_nl' | 'review_text_de'
  | 'review_text_fr' | 'review_text_es' | 'review_text_pt' | 'review_text_zh'
>

interface ReviewsSectionProps {
  reviews: Review[]
  /** Combined Google + TripAdvisor review count — defaults to the loaded review count when not provided. */
  totalReviewCount?: number
  locale: Locale
  sectionStyle?: SectionStyle
}

export async function ReviewsSection({
  reviews,
  totalReviewCount,
  locale,
  sectionStyle,
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

  return (
    <section className="bg-[var(--color-sand)] py-16 sm:py-20 overflow-hidden relative" style={sectionRootStyle(sectionStyle)}>
      {/* Decorative star — on desktop it sits in the top-right corner; on mobile
          it drops below the heading (the right side there is empty) so it never
          covers the "...SAY" of the title. */}
      <Image
        src="/icons/star-yellow.png"
        alt=""
        aria-hidden="true"
        width={816}
        height={846}
        className="absolute top-28 right-4 w-20 sm:top-6 sm:right-10 sm:w-28 lg:right-16 lg:w-36 h-auto rotate-12 pointer-events-none select-none z-10"
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">

        {/* Header */}
        <div className="text-center mb-10">
          <h2 className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] leading-none mb-3 uppercase" style={{ color: roleColor('h2', '#343499') }}>
            {t('title')}
          </h2>
          <p className="font-avenir text-sm" style={{ color: roleColor('body', '#6b7280') }}>
            {displayCount}+ verified reviews
          </p>
        </div>

        {/* Slider (client component) — shows source tabs only when both sources present */}
        <ReviewsSlider reviews={sliderReviews} totalReviews={displayCount} showSourceTabs={hasGoogle && hasTa} />
      </div>
    </section>
  )
}
