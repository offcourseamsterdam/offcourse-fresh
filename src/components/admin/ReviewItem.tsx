'use client'

import { Trash2, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StarRating } from '@/components/ui/StarRating'
import { SafeImage } from '@/components/ui/SafeImage'
import { ReviewPhoto } from '@/components/ui/ReviewPhoto'
import type { Review } from '@/app/[locale]/admin/reviews/types'

export interface ReviewItemProps {
  review: Review
  onToggleActive: (review: Review) => void
  onDelete: (review: Review) => void
}

export function ReviewItem({ review, onToggleActive, onDelete }: ReviewItemProps) {
  const isTa = review.source === 'tripadvisor'

  return (
    <li className="px-6 py-4 space-y-3">
      <div className="flex items-start gap-4">
        {/* Author photo */}
        <div className="relative w-10 h-10 rounded-full overflow-hidden bg-zinc-100 flex-shrink-0">
          {review.author_photo_url ? (
            <SafeImage
              src={review.author_photo_url}
              alt={review.reviewer_name}
              fill
              sizes="40px"
              className="object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm font-semibold">
              {review.reviewer_name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-medium text-sm text-zinc-900">{review.reviewer_name}</span>
            <StarRating rating={review.rating} className="[&_svg]:w-3 [&_svg]:h-3" />
            <Badge
              variant={isTa ? 'secondary' : 'default'}
              className="text-[10px] px-1.5 py-0"
            >
              {isTa ? '🦉 TripAdvisor' : '⭐ Google'}
            </Badge>
            {review.google_profile_url && (
              <a href={review.google_profile_url} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-zinc-500 transition-colors">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Review title (TripAdvisor original_text) */}
          {review.original_text && (
            <p className="text-xs font-medium text-zinc-500 mb-0.5 italic">{review.original_text}</p>
          )}

          <p className="text-sm text-zinc-600 leading-relaxed">{review.review_text}</p>

          {/* Review photo */}
          {review.review_image_url && (
            <div className="mt-2">
              <ReviewPhoto src={review.review_image_url} className="rounded-lg object-cover max-h-20" />
            </div>
          )}

          {review.publish_time && (
            <p className="text-xs text-zinc-400 mt-1">
              {new Date(review.publish_time).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={review.is_active}
              onChange={() => onToggleActive(review)}
              className="w-4 h-4 accent-zinc-900"
            />
            <span className="text-xs text-zinc-500">Active</span>
          </label>
          <button onClick={() => onDelete(review)} className="text-zinc-300 hover:text-red-400 transition-colors">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </li>
  )
}
