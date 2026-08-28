'use client'

import { useState, useMemo } from 'react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { Review, ReviewsConfig, StaffOption } from './types'
import { computeReviewsOverview } from './overview'

interface ReviewsData {
  reviews: Review[]
  config: ReviewsConfig | null
  bookingsCount: number
}

interface StaffData {
  staff: { id: string; name: string; is_active: boolean }[]
}

export function useReviews() {
  const { data, isLoading: loading, error, refresh: fetchReviews, mutate } =
    useAdminFetch<ReviewsData>('/api/admin/reviews')
  // Reuses the Scheduling tab's own staff list endpoint rather than adding a
  // second one — the assign dropdown only needs id + name of active staff.
  const { data: staffData } = useAdminFetch<StaffData>('/api/admin/scheduling/staff')

  const reviews = data?.reviews ?? []
  const config = data?.config ?? null
  const bookingsCount = data?.bookingsCount ?? 0
  const activeStaff: StaffOption[] = (staffData?.staff ?? []).filter(s => s.is_active).map(s => ({ id: s.id, name: s.name }))

  /** Optimistically patches one review in place; every action below calls this before its fetch and again to roll back on failure. */
  function patchReview(id: string, patch: Partial<Review>) {
    mutate(prev => prev ? { ...prev, reviews: prev.reviews.map(r => r.id === id ? { ...r, ...patch } : r) } : prev, { revalidate: false })
  }

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  async function saveConfig(updates: {
    placeId: string
    tripadvisorUrl?: string
    withlocalsShortId?: string
    recommendationsMapUrl?: string
    tripadvisorReviewUrlShared?: string
    tripadvisorReviewUrlPrivate?: string
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
        tripadvisor_review_url_shared: updates.tripadvisorReviewUrlShared || null,
        tripadvisor_review_url_private: updates.tripadvisorReviewUrlPrivate || null,
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
    patchReview(review.id, { is_active: !review.is_active })
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !review.is_active }),
      })
      const json = await res.json()
      if (!json.ok) patchReview(review.id, { is_active: review.is_active })
    } catch {
      patchReview(review.id, { is_active: review.is_active })
    }
  }

  async function assignReview(review: Review, staffId: string | null) {
    const previousStatus = review.matchStatus
    // Placeholder amount/date — the immediate fetchReviews() below replaces
    // this with the real row the instant the POST resolves.
    const optimisticStatus: Review['matchStatus'] = staffId
      ? { status: 'assigned', assignees: [{ ...(activeStaff.find(s => s.id === staffId) ?? { id: staffId, name: '…' }), amountCents: 500, awardedAt: new Date().toISOString() }] }
      : { status: 'no_match' }
    patchReview(review.id, { matchStatus: optimisticStatus })
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId }),
        credentials: 'include',
      })
      const json = await res.json()
      if (json.ok) {
        await fetchReviews()
      } else {
        patchReview(review.id, { matchStatus: previousStatus })
      }
    } catch {
      patchReview(review.id, { matchStatus: previousStatus })
    }
  }

  const [draftingIds, setDraftingIds] = useState<Set<string>>(new Set())

  async function draftReply(review: Review) {
    setDraftingIds(prev => new Set(prev).add(review.id))
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}/draft-reply`, { method: 'POST' })
      const json = await res.json()
      if (json.ok) patchReview(review.id, { ai_draft_reply: json.data.draft })
    } finally {
      setDraftingIds(prev => {
        const next = new Set(prev)
        next.delete(review.id)
        return next
      })
    }
  }

  async function toggleReplied(review: Review) {
    const previousRepliedAt = review.replied_at
    const nextRepliedAt = previousRepliedAt ? null : new Date().toISOString()
    patchReview(review.id, { replied_at: nextRepliedAt })
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replied_at: nextRepliedAt }),
      })
      const json = await res.json()
      if (!json.ok) patchReview(review.id, { replied_at: previousRepliedAt })
    } catch {
      patchReview(review.id, { replied_at: previousRepliedAt })
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
  const overview = useMemo(() => computeReviewsOverview(reviews), [reviews])

  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)

  async function backfillScan() {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/admin/reviews/backfill-bonus-scan', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        setScanResult(
          json.data.started
            ? `Scanning ${json.data.count} review${json.data.count === 1 ? '' : 's'} — this runs in the background, check your Slack DM for the summary (missing captains, if any) and hit Refresh in a few minutes.`
            : 'Everything is already scanned — nothing to do.'
        )
      } else {
        setScanResult(`Error: ${json.error}`)
      }
    } catch {
      setScanResult('Network error starting the scan')
    } finally {
      setScanning(false)
    }
  }

  return {
    reviews, loading, error, config, fetchReviews,
    syncing, syncResult, handleSync, saveConfig,
    toggleActive, handleDelete, assignReview, activeStaff,
    draftReply, draftingIds, toggleReplied,
    googleReviews, taReviews, withlocalsReviews, activeReviews,
    bookingsCount,
    overview, scanning, scanResult, backfillScan,
  }
}
