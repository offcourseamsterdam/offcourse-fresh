import type { WithlocalsReview } from './client'
import type { ReviewRow } from '@/lib/outscraper/parse'

const DEFAULT_AVATAR = 'https://withlocals-com-res.cloudinary.com/image/upload/v1550848581/website/avatar/default-user.png'

function cleanGuestName(raw: string | null): string {
  if (!raw) return 'Anonymous'
  // Apple Sign-In relay emails: zvsjwfm2yt@privaterelay.appleid.com → Anonymous
  if (raw.includes('@privaterelay.appleid.com')) return 'Anonymous'
  if (raw.includes('@')) return raw.split('@')[0]
  return raw
}

/**
 * Strip platform-injected prefixes from Withlocals aggregated review text.
 *
 * Two patterns observed in the wild:
 *  1. TripAdvisor imports:  "Tripadvisor review: [title]\n[actual text]"
 *  2. Internal boat ratings: "[name] has rated [boat] with[title] [actual text]"
 *     e.g. "Pushpika has rated Diana withGreat boattrip! The captain was..."
 *     Here the comment echoes the title field at the start — strip it.
 */
export function cleanReviewText(comment: string, title: string | null): string {
  let text = comment.trim()

  // Some reviews echo the title at the very start of the comment body — strip it first.
  // e.g. "The Best Amsterdam boat experience\nTripadvisor review: …\nActual text"
  if (title && text.startsWith(title)) {
    text = text.slice(title.length).replace(/^[\s!.,;:\n]+/, '').trim()
  }

  // Strip "Tripadvisor review: [subtitle]\n[actual text]" — may appear at the start
  // OR after stripping the title prefix above.
  const taMatch = text.match(/^Tripadvisor review:.*?\n([\s\S]+)$/)
  if (taMatch) return taMatch[1].trim()

  return text
}

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Withlocals format: "2026-05-12T00:44:24" (no timezone) — treat as UTC
  const d = new Date(`${raw}Z`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function parseWithlocalsReview(r: WithlocalsReview): ReviewRow {
  // Withlocals uses scale=10 for genuine reviews and scale=5 for aggregated (TripAdvisor) ones.
  // The formula handles both: (rating / scale) * 5 → always yields 1–5.
  const rating = Math.round((r.rating / r.scale) * 5)
  const reviewText = cleanReviewText(r.comment ?? '', r.title ?? null)

  // For aggregated TripAdvisor reviews the title is the real review headline;
  // for "Pushpika has rated…" rows it's noise — discard it.
  const isInternalPrefix = r.title?.match(/^.+ has rated .+ with/)
  const originalText = isInternalPrefix ? null : (r.title || null)

  return {
    external_review_id: r.id,
    source: 'withlocals',
    reviewer_name: cleanGuestName(r.guest_name),
    rating,
    review_text: reviewText,
    original_text: originalText,
    language: r.detected_language ?? 'en',
    author_photo_url: r.guest_picture && r.guest_picture !== DEFAULT_AVATAR ? r.guest_picture : null,
    review_image_url: null,
    publish_time: parseDate(r.created),
    google_profile_url: null,
    is_active: false,
  }
}
