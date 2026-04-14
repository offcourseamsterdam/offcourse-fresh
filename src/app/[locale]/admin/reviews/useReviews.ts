'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Review, GoogleConfig } from './types'

export function useReviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Google sync state
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [config, setConfig] = useState<GoogleConfig | null>(null)

  // Place search
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<{ placeId: string; name: string } | null>(null)

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/reviews')
      const json = await res.json()
      if (json.ok) {
        setReviews(json.data?.reviews ?? [])
        if (json.data?.config) {
          setConfig(json.data.config)
        }
      } else {
        setError(json.error ?? 'Failed to load reviews')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])

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

  // ── Toggle active ────────────────────────────────────────────────────────────

  async function toggleActive(review: Review) {
    setReviews(prev =>
      prev.map(r => (r.id === review.id ? { ...r, is_active: !r.is_active } : r))
    )
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !review.is_active }),
      })
      const json = await res.json()
      if (!json.ok) {
        setReviews(prev =>
          prev.map(r => (r.id === review.id ? { ...r, is_active: review.is_active } : r))
        )
      }
    } catch {
      setReviews(prev =>
        prev.map(r => (r.id === review.id ? { ...r, is_active: review.is_active } : r))
      )
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async function handleDelete(review: Review) {
    if (!confirm(`Delete review by "${review.reviewer_name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.ok) {
        setReviews(prev => prev.filter(r => r.id !== review.id))
      }
    } catch {
      // silent
    }
  }

  // ── Helpers for child hooks ──────────────────────────────────────────────────

  /** Update a single review's fields in state (used by useReplyEditor) */
  const updateReview = useCallback(
    (id: string, fields: Partial<Review>) => {
      setReviews(prev => prev.map(r => (r.id === id ? { ...r, ...fields } : r)))
    },
    []
  )

  // ── Computed values ──────────────────────────────────────────────────────────

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
