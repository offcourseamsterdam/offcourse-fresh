'use client'

/**
 * Renders a photo attached to a review (from Outscraper).
 *
 * Uses a plain <img> (not next/image) on purpose: review image URLs come from
 * unpredictable Google/TripAdvisor CDN hosts and can EXPIRE over time. next/image
 * requires every host to be allowlisted and errors on unknown ones. A plain <img>
 * works with any host and hides itself gracefully via onError when a URL 404s.
 */
export function ReviewPhoto({ src, className }: { src: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Review photo"
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      onError={e => {
        ;(e.currentTarget as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}
