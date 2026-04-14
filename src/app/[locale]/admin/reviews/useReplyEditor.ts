'use client'

import { useState } from 'react'
import type { Review } from './types'

type UpdateReviewFn = (id: string, fields: Partial<Review>) => void

export function useReplyEditor(updateReview: UpdateReviewFn) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)

  // AI draft state
  const [generatingFor, setGeneratingFor] = useState<string | null>(null)

  function openReply(review: Review) {
    setReplyingTo(review.id)
    setReplyText(review.owner_reply_text ?? '')
    setReplyError(null)
  }

  function closeReply() {
    setReplyingTo(null)
    setReplyText('')
    setReplyError(null)
  }

  async function generateAiReply(reviewId: string) {
    setGeneratingFor(reviewId)
    setReplyError(null)
    try {
      const res = await fetch('/api/admin/reviews/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId }),
      })
      const json = await res.json()
      if (json.ok) {
        const draft = json.data.reply
        // Update the review in state with the draft
        updateReview(reviewId, { ai_draft_reply: draft })
        // Open the reply editor with the AI draft pre-filled
        setReplyingTo(reviewId)
        setReplyText(draft)
      } else {
        setReplyError(json.error ?? 'Failed to generate reply')
        setReplyingTo(reviewId)
      }
    } catch {
      setReplyError('Network error generating reply')
      setReplyingTo(reviewId)
    } finally {
      setGeneratingFor(null)
    }
  }

  async function submitReply(reviewId: string) {
    if (!replyText.trim()) return
    setReplySubmitting(true)
    setReplyError(null)
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}/reply`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply_text: replyText.trim() }),
      })
      const json = await res.json()
      if (json.ok) {
        updateReview(reviewId, {
          owner_reply_text: json.data.reply_text,
          owner_reply_time: json.data.reply_time,
          reply_synced_at: json.data.reply_time,
        })
        closeReply()
      } else {
        setReplyError(json.error ?? 'Failed to send reply')
      }
    } catch {
      setReplyError('Network error')
    } finally {
      setReplySubmitting(false)
    }
  }

  async function deleteReply(reviewId: string) {
    if (!confirm('Delete this reply? It will be removed from Google.')) return
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}/reply`, { method: 'DELETE' })
      const json = await res.json()
      if (json.ok) {
        updateReview(reviewId, {
          owner_reply_text: null,
          owner_reply_time: null,
          reply_synced_at: null,
        })
      }
    } catch {
      // silent
    }
  }

  return {
    replyingTo,
    replyText,
    setReplyText,
    replyError,
    replySubmitting,
    generatingFor,
    openReply,
    closeReply,
    submitReply,
    deleteReply,
    generateAiReply,
  }
}
