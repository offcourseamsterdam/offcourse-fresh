'use client'

import { useState } from 'react'
import { Trash2, ExternalLink, Users, CircleAlert, Copy, Check, Sparkles, Loader2, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StarRating } from '@/components/ui/StarRating'
import { SafeImage } from '@/components/ui/SafeImage'
import { ReviewPhoto } from '@/components/ui/ReviewPhoto'
import type { Review, StaffOption } from '@/app/[locale]/admin/reviews/types'

export interface ReviewItemProps {
  review: Review
  onToggleActive: (review: Review) => void
  onDelete: (review: Review) => void
  onAssign: (review: Review, staffId: string | null) => void
  activeStaff: StaffOption[]
  onDraftReply: (review: Review) => void
  onToggleReplied: (review: Review) => void
  isDrafting: boolean
}

/**
 * Copy-paste is the whole reply feature (Beer, 2026-08-22, plan Phase 4) —
 * no platform here gets auto-posted to, so this button IS the "send" action.
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/**
 * The reply draft + copy-paste flow. Every platform gets the same control —
 * Google included, since none of the four are wired to auto-post (that's a
 * separate, larger OAuth project Beer deferred). "Replied" is a manual,
 * self-reported flag: nothing here confirms the paste actually happened on
 * the platform.
 */
function ReplyControl({ review, onDraftReply, onToggleReplied, isDrafting }: Pick<ReviewItemProps, 'review' | 'onDraftReply' | 'onToggleReplied' | 'isDrafting'>) {
  if (review.replied_at) {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium">
          <Check className="w-3 h-3" />
          Replied {new Date(review.replied_at).toLocaleDateString()}
        </span>
        <button
          onClick={() => onToggleReplied(review)}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          <Undo2 className="w-3 h-3" /> Undo
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {review.ai_draft_reply && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-xs text-zinc-600 leading-relaxed">
          {review.ai_draft_reply}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => onDraftReply(review)}
          disabled={isDrafting}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
        >
          {isDrafting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {review.ai_draft_reply ? 'Regenerate' : 'Draft reply'}
        </button>
        {review.ai_draft_reply && (
          <>
            <CopyButton text={review.ai_draft_reply} />
            <button
              onClick={() => onToggleReplied(review)}
              className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              Mark as replied
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The review's €5 bonus status — generalizes the old standalone
 * BonusConflictCards panel into a row-level control (Beer, 2026-08-22, plan
 * §3.2). One dropdown, always the same shape, regardless of whether the
 * review currently has nobody matched, one confirmed assignee, or a pending
 * pick between candidates who share a first name.
 */
function MatchStatusControl({ review, onAssign, activeStaff }: Pick<ReviewItemProps, 'review' | 'onAssign' | 'activeStaff'>) {
  const { matchStatus } = review

  // Bonuses are 5-star only (Beer, 2026-08-22) — a review below that can
  // never have a match to show or a manual override to offer.
  if (review.rating < 5 && matchStatus.status === 'no_match') return null

  if (matchStatus.status === 'needs_confirmation') {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold">
          <CircleAlert className="w-3 h-3" />
          Needs confirmation — &quot;{matchStatus.matchedName}&quot;
        </span>
        {matchStatus.candidates.map(c => (
          <button
            key={c.id}
            onClick={() => onAssign(review, c.id)}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            {c.name.split(' ')[0]} gets €5
          </button>
        ))}
        <button
          onClick={() => onAssign(review, null)}
          className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors"
        >
          Skip
        </button>
      </div>
    )
  }

  const currentAssigneeId = matchStatus.status === 'assigned' ? matchStatus.assignees[0]?.id ?? '' : ''

  return (
    <div className="flex items-center gap-1.5">
      {matchStatus.status === 'assigned' ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-medium">
          <Users className="w-3 h-3" />
          {matchStatus.assignees.map(a => a.name).join(', ')} · €5
        </span>
      ) : (
        <span className="text-[11px] text-zinc-400">No match</span>
      )}
      <select
        value={currentAssigneeId}
        onChange={e => onAssign(review, e.target.value || null)}
        className="text-[11px] text-zinc-500 border border-zinc-200 rounded-lg px-1.5 py-0.5 bg-white hover:border-zinc-300 transition-colors"
      >
        <option value="">{matchStatus.status === 'assigned' ? 'Reassign…' : 'Assign…'}</option>
        {activeStaff.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  )
}

export function ReviewItem({ review, onToggleActive, onDelete, onAssign, activeStaff, onDraftReply, onToggleReplied, isDrafting }: ReviewItemProps) {
  function sourceBadge(source: string): { label: string; variant: 'default' | 'secondary' | 'outline' } {
    if (source === 'tripadvisor') return { label: '🦉 TripAdvisor', variant: 'secondary' }
    if (source === 'withlocals') return { label: '🏠 Withlocals', variant: 'outline' }
    if (source === 'getyourguide') return { label: '🌍 GetYourGuide', variant: 'outline' }
    return { label: '⭐ Google', variant: 'default' }
  }

  const badge = sourceBadge(review.source)

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
              variant={badge.variant}
              className="text-[10px] px-1.5 py-0"
            >
              {badge.label}
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

          <div className="mt-2">
            <MatchStatusControl review={review} onAssign={onAssign} activeStaff={activeStaff} />
          </div>

          {/* Withlocals has no reply mechanism at all — not just no API, no
              dashboard reply feature either (Beer, 2026-08-22) — so offering
              a draft-and-copy flow with nowhere to paste it would be
              misleading. Google, TripAdvisor, and GetYourGuide (confirmed by
              its own notification email's "Reply to review" link) all have
              a real place to paste a reply, even without an auto-post API. */}
          {review.review_text && review.source !== 'withlocals' && (
            <div className="mt-2">
              <ReplyControl review={review} onDraftReply={onDraftReply} onToggleReplied={onToggleReplied} isDrafting={isDrafting} />
            </div>
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
