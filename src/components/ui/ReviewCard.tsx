import Image from 'next/image'
import { StarRating } from '@/components/ui/StarRating'

interface ReviewCardProps {
  reviewerName: string
  reviewText: string
  rating: number
  source: string | null
  authorPhotoUrl: string | null
  /** 'default' = homepage grid card, 'compact' = cruise detail inline card */
  variant?: 'default' | 'compact'
}

export function ReviewCard({
  reviewerName,
  reviewText,
  rating,
  source,
  authorPhotoUrl,
  variant = 'default',
}: ReviewCardProps) {
  const isCompact = variant === 'compact'
  const photoSize = isCompact ? 28 : 32
  const photoClass = isCompact ? 'w-7 h-7' : 'w-8 h-8'

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

      {/* Default: photo + name + source in footer */}
      {!isCompact && (
        <footer className="flex items-center gap-3">
          <AuthorPhoto url={authorPhotoUrl} name={reviewerName} size={photoSize} className={photoClass} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[var(--color-primary)] text-sm truncate">
              {reviewerName}
            </p>
          </div>
          {source && (
            <span className="text-xs text-[var(--color-muted)] capitalize flex-shrink-0">
              {source}
            </span>
          )}
        </footer>
      )}

      {/* Compact: source below text */}
      {isCompact && source && (
        <span className="text-xs text-[var(--color-muted)] capitalize">
          {source}
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
