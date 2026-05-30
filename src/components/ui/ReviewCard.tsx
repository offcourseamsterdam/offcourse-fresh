import Image from 'next/image'
import { StarRating } from '@/components/ui/StarRating'
import { ReviewPhoto } from '@/components/ui/ReviewPhoto'

interface ReviewCardProps {
  reviewerName: string
  reviewText: string
  rating: number
  source: string | null
  authorPhotoUrl: string | null
  reviewImageUrl?: string | null
  /** 'default' = homepage grid card, 'compact' = cruise detail inline card */
  variant?: 'default' | 'compact'
}

/** Honest source attribution (per SEO decision — cite the third-party source). */
function sourceLabel(source: string | null): string {
  if (source === 'tripadvisor') return 'via TripAdvisor'
  if (source === 'google') return 'via Google'
  return ''
}

export function ReviewCard({
  reviewerName,
  reviewText,
  rating,
  source,
  authorPhotoUrl,
  reviewImageUrl,
  variant = 'default',
}: ReviewCardProps) {
  const isCompact = variant === 'compact'
  const photoSize = isCompact ? 28 : 32
  const photoClass = isCompact ? 'w-7 h-7' : 'w-8 h-8'
  const label = sourceLabel(source)

  return (
    <article
      className={`bg-[var(--color-sand)] flex flex-col ${
        isCompact ? 'rounded-xl p-5 gap-2' : 'rounded-2xl p-6 gap-3'
      }`}
    >
      {/* Compact: photo + name + stars in one row */}
      {isCompact && (
        <div className="flex items-center gap-3">
          <AuthorPhoto url={authorPhotoUrl} name={reviewerName} size={photoSize} className={photoClass} showFallback />
          <span className="font-semibold text-sm text-[var(--color-primary)]">
            {reviewerName}
          </span>
          <StarRating rating={rating} className="ml-auto" />
        </div>
      )}

      {/* Default: stars on top */}
      {!isCompact && <StarRating rating={rating} />}

      <blockquote className={`text-sm leading-relaxed ${
        isCompact ? 'text-[var(--color-foreground)]' : 'text-[var(--color-foreground)] flex-1'
      }`}>
        &ldquo;{reviewText}&rdquo;
      </blockquote>

      {/* Review photo (gracefully hidden if it fails to load / expired) */}
      {reviewImageUrl && (
        <ReviewPhoto src={reviewImageUrl} className="rounded-lg object-cover w-full max-h-44" />
      )}

      {/* Default: photo + name + source in footer */}
      {!isCompact && (
        <footer className="flex items-center gap-3">
          <AuthorPhoto url={authorPhotoUrl} name={reviewerName} size={photoSize} className={photoClass} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[var(--color-primary)] text-sm truncate">
              {reviewerName}
            </p>
          </div>
          {label && (
            <span className="text-xs text-[var(--color-muted)] flex-shrink-0">
              {label}
            </span>
          )}
        </footer>
      )}

      {/* Compact: source below text */}
      {isCompact && label && (
        <span className="text-xs text-[var(--color-muted)]">
          {label}
        </span>
      )}
    </article>
  )
}

/** Small helper to render author photo or initial fallback */
function AuthorPhoto({
  url,
  name,
  size,
  className,
  showFallback,
}: {
  url: string | null
  name: string
  size: number
  className: string
  showFallback?: boolean
}) {
  if (url) {
    return (
      <Image
        src={url}
        alt={name}
        width={size}
        height={size}
        className={`${className} rounded-full object-cover`}
        referrerPolicy="no-referrer"
      />
    )
  }

  if (showFallback) {
    return (
      <div className={`${className} rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-xs font-semibold`}>
        {name.charAt(0).toUpperCase()}
      </div>
    )
  }

  return null
}
