'use client'

import { useState } from 'react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { Review, ReviewsConfig } from './types'

interface ReviewsData {
  reviews: Review[]
  config: ReviewsConfig | null
}

export function useReviews() {
  const { data, isLoading: loading, error, refresh: fetchReviews, mutate } =
    useAdminFetch<ReviewsData>('/api/admin/reviews')

  const reviews = data?.reviews ?? []
  const config = data?.config ?? null

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  async function saveConfig(updates: {
    placeId: string
    tripadvisorUrl?: string
    withlocalsShortId?: string
    recommendationsMapUrl?: string
    tripadvisorReviewUrl?: string
    reviewSmsTemplate?: string
    reviewSmsAutoSend?: boolean
    reviewSmsEnabled?: boolean
  }) {
    const res = await fetch('/api/admin/reviews', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place_id: updates.placeId,
        tripadvisor_url: updates.tripadvisorUrl || null,
        withlocals_experience_short_id: updates.withlocalsShortId || null,
        recommendations_map_url: updates.recommendationsMapUrl || null,
        tripadvisor_review_url: updates.tripadvisorReviewUrl || null,
        review_sms_template: updates.reviewSmsTemplate || null,
        review_sms_auto_send: updates.reviewSmsAutoSend ?? false,
        review_sms_enabled: updates.reviewSmsEnabled ?? true,
      }),
    })
    const json = await res.json()
    if (json.ok) await fetchReviews()
    return json.ok
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/admin/reviews/sync', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        const sources: string[] = json.data?.started ?? []
        setSyncResult(
          `Sync started for ${sources.join(' + ') || 'no sources'} — new reviews appear in ~1–2 min. Hit Refresh.`
        )
      } else {
        setSyncResult(`Error: ${json.error}`)
      }
    } catch {
      setSyncResult('Network error during sync')
    } finally {
      setSyncing(false)
    }
  }

  async function toggleActive(review: Review) {
    mutate(prev => prev ? { ...prev, reviews: prev.reviews.map(r => r.id === review.id ? { ...r, is_active: !r.is_active } : r) } : prev, { revalidate: false })
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !review.is_active }),
      })
      const json = await res.json()
      if (!json.ok) {
        mutate(prev => prev ? { ...prev, reviews: prev.reviews.map(r => r.id === review.id ? { ...r, is_active: review.is_active } : r) } : prev, { revalidate: false })
      }
    } catch {
      mutate(prev => prev ? { ...prev, reviews: prev.reviews.map(r => r.id === review.id ? { ...r, is_active: review.is_active } : r) } : prev, { revalidate: false })
    }
  }

  async function handleDelete(review: Review) {
    if (!confirm(`Delete review by "${review.reviewer_name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.ok) {
        mutate(prev => prev ? { ...prev, reviews: prev.reviews.filter(r => r.id !== review.id) } : prev, { revalidate: false })
      }
    } catch { /* silent */ }
  }

  const googleReviews = reviews.filter(r => r.source === 'google')
  const taReviews = reviews.filter(r => r.source === 'tripadvisor')
  const withlocalsReviews = reviews.filter(r => r.source === 'withlocals')
  const activeReviews = reviews.filter(r => r.is_active)

  return {
    reviews, loading, error, config, fetchReviews,
    syncing, syncResult, handleSync, saveConfig,
    toggleActive, handleDelete,
    googleReviews, taReviews, withlocalsReviews, activeReviews,
  }
}
