'use client'

import { useState, useEffect } from 'react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { Review, GoogleConfig } from './types'

interface ReviewsData {
  reviews: Review[]
  config: GoogleConfig | null
}

export function useReviews() {
  const { data, isLoading: loading, error, refresh: fetchReviews, mutate } =
    useAdminFetch<ReviewsData>('/api/admin/reviews')

  const reviews = data?.reviews ?? []
  const config = data?.config ?? null

  // Google sync state
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  // Place search
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<{ placeId: string; name: string } | null>(null)

  // Handle OAuth redirect query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('google_connected') === 'true') {
      setSyncResult('Google Business Profile connected successfully!')
      window.history.replaceState({}, '', window.location.pathname)
    }
    const gbpError = params.get('gbp_error')
    if (gbpError) {
      setSyncResult(`Error connecting Google: ${gbpError}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // ── setConfig (used by child components) ─────────────────────────────────────

  function setConfig(newConfig: GoogleConfig | null) {
    mutate(prev => prev ? { ...prev, config: newConfig } : prev, { revalidate: false })
  }

  // ── Google sync ──────────────────────────────────────────────────────────────

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/admin/reviews/sync-google', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        const d = json.data
        setSyncResult(
          `Synced ${d.synced} review${d.synced !== 1 ? 's' : ''} from Google` +
          (d.skipped ? ` (${d.skipped} skipped)` : '') +
          (d.errors?.length ? ` — ${d.errors.length} error(s)` : '')
        )
        await fetchReviews()
      } else {
        setSyncResult(`Error: ${json.error}`)
      }
    } catch {
      setSyncResult('Network error during sync')
    } finally {
      setSyncing(false)
    }
  }

  // ── Place search ─────────────────────────────────────────────────────────────

  async function handlePlaceSearch() {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchResult(null)
    try {
      const res = await fetch(
        `/api/admin/reviews/sync-google?q=${encodeURIComponent(searchQuery)}`
      )
      const json = await res.json()
      if (json.ok && json.data?.place) {
        setSearchResult(json.data.place)
      } else {
        setSearchResult(null)
        setSyncResult(json.data?.message ?? 'No place found')
      }
    } catch {
      setSyncResult('Search failed')
    } finally {
      setSearching(false)
    }
  }

  // ── Toggle active ─────────────────────────────────────────────────────────────

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

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function handleDelete(review: Review) {
    if (!confirm(`Delete review by "${review.reviewer_name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.ok) {
        mutate(prev => prev ? { ...prev, reviews: prev.reviews.filter(r => r.id !== review.id) } : prev, { revalidate: false })
      }
    } catch {
      // silent
    }
  }

  // ── Helper for child hooks ────────────────────────────────────────────────────

  function updateReview(id: string, fields: Partial<Review>) {
    mutate(prev => prev ? { ...prev, reviews: prev.reviews.map(r => r.id === id ? { ...r, ...fields } : r) } : prev, { revalidate: false })
  }

  // ── Computed values ───────────────────────────────────────────────────────────

  const googleReviews = reviews.filter(r => r.source === 'google')
  const activeReviews = reviews.filter(r => r.is_active)
  const isGbpConnected = config?.is_gbp_connected ?? false
  const isPlaceConfigured = !!config?.place_id

  return {
    // Data
    reviews,
    loading,
    error,
    config,
    setConfig,

    // Sync
    syncing,
    syncResult,
    handleSync,
    fetchReviews,

    // Place search
    searchQuery,
    setSearchQuery,
    searching,
    searchResult,
    handlePlaceSearch,

    // Actions
    toggleActive,
    handleDelete,

    // Helper for child hooks
    updateReview,

    // Computed
    googleReviews,
    activeReviews,
    isGbpConnected,
    isPlaceConfigured,
  }
}
