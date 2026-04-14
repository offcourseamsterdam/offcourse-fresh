'use client'

import { Loader2, Trash2, ExternalLink, MessageSquare, Pencil, Sparkles, RotateCcw, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StarRating } from '@/components/ui/StarRating'
import type { Review } from '@/app/[locale]/admin/reviews/types'

export interface ReviewItemProps {
  review: Review
  isGbpConnected: boolean
  replyingTo: string | null
  replyText: string
  replyError: string | null
  replySubmitting: boolean
  generatingFor: string | null
  onToggleActive: (review: Review) => void
  onDelete: (review: Review) => void
  onOpenReply: (review: Review) => void
  onCloseReply: () => void
  onReplyTextChange: (text: string) => void
  onSubmitReply: (reviewId: string) => void
  onDeleteReply: (reviewId: string) => void
  onGenerateReply: (reviewId: string) => void
}

export function ReviewItem({
  review,
  isGbpConnected,
  replyingTo,
  replyText,
  replyError,
  replySubmitting,
  generatingFor,
  onToggleActive,
  onDelete,
  onOpenReply,
  onCloseReply,
  onReplyTextChange,
  onSubmitReply,
  onDeleteReply,
  onGenerateReply,
}: ReviewItemProps) {
  return (
    <li className="px-6 py-4 space-y-3">
      <div className="flex items-start gap-4">
        {/* Author photo */}
        <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-100 flex-shrink-0">
          {review.author_photo_url ? (
            <img
              src={review.author_photo_url}
              alt={review.reviewer_name}
              className="w-full h-full object-cover"
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
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-zinc-900">
              {review.reviewer_name}
            </span>
            <StarRating rating={review.rating} className="[&_svg]:w-3 [&_svg]:h-3" />
            <Badge
              variant={review.source === 'google' ? 'default' : 'secondary'}
              className="text-[10px] px-1.5 py-0"
            >
              {review.source}
            </Badge>
            {review.google_profile_url && (
              <a
                href={review.google_profile_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-300 hover:text-zinc-500 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <p className="text-sm text-zinc-600 leading-relaxed">
            {review.review_text}
          </p>
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
          <button
            onClick={() => onDelete(review)}
            className="text-zinc-300 hover:text-red-400 transition-colors"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Existing reply display */}
      {review.owner_reply_text && replyingTo !== review.id && (
        <div className="ml-14 bg-zinc-50 rounded-lg px-4 py-3 border border-zinc-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-zinc-500">Your reply</span>
            <div className="flex items-center gap-2">
              {review.source === 'google' && isGbpConnected && (
                <button
                  onClick={() => onOpenReply(review)}
                  className="text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  <Pencil size={12} />
                </button>
              )}
              {review.source === 'google' && isGbpConnected && (
                <button
                  onClick={() => onDeleteReply(review.id)}
                  className="text-zinc-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-zinc-600">{review.owner_reply_text}</p>
          {review.owner_reply_time && (
            <p className="text-xs text-zinc-400 mt-1">
              {new Date(review.owner_reply_time).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Reply buttons (for reviews without a reply) */}
      {!review.owner_reply_text &&
        replyingTo !== review.id && (
        <div className="ml-14 flex items-center gap-3">
          <button
            onClick={() => onGenerateReply(review.id)}
            disabled={generatingFor === review.id}
            className="flex items-center gap-1.5 text-xs text-purple-500 hover:text-purple-700 transition-colors disabled:opacity-50"
          >
            {generatingFor === review.id ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {generatingFor === review.id ? 'Generating...' : 'Generate Reply'}
          </button>
          {review.source === 'google' && isGbpConnected && (
            <button
              onClick={() => onOpenReply(review)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <MessageSquare size={12} />
              Write manually
            </button>
          )}
        </div>
      )}

      {/* Reply editor (inline) */}
      {replyingTo === review.id && (
        <div className="ml-14 space-y-2">
          {review.ai_draft_reply && replyText === review.ai_draft_reply && (
            <div className="flex items-center gap-1.5 text-xs text-purple-500">
              <Sparkles size={11} />
              AI-generated draft — edit freely, then confirm
            </div>
          )}
          <textarea
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
            rows={3}
            placeholder="Write your reply..."
            value={replyText}
            onChange={e => onReplyTextChange(e.target.value)}
            maxLength={4096}
          />
          {replyError && (
            <p className="text-xs text-red-600">{replyError}</p>
          )}
          <div className="flex items-center gap-2">
            {review.source === 'google' && isGbpConnected ? (
              <Button
                size="sm"
                onClick={() => onSubmitReply(review.id)}
                disabled={replySubmitting || !replyText.trim()}
              >
                {replySubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                {replySubmitting ? 'Posting...' : 'Confirm & Post'}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  // Save draft locally without posting to Google
                  onSubmitReply(review.id)
                }}
                disabled={replySubmitting || !replyText.trim()}
              >
                {replySubmitting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                {replySubmitting ? 'Saving...' : 'Save Reply'}
              </Button>
            )}
            <button
              onClick={() => onGenerateReply(review.id)}
              disabled={generatingFor === review.id}
              className="text-xs text-purple-500 hover:text-purple-700 flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              {generatingFor === review.id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              Regenerate
            </button>
            <button
              onClick={onCloseReply}
              className="text-xs text-zinc-400 hover:text-zinc-600 flex items-center gap-1 transition-colors"
            >
              <X size={12} />
              Cancel
            </button>
            <span className="text-xs text-zinc-300 ml-auto">
              {replyText.length}/4096
            </span>
          </div>
        </div>
      )}
    </li>
  )
}
