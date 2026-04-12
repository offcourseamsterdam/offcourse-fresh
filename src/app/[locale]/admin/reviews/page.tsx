'use client'

import { useState, useEffect, useCallback } from 'react'
import { Star, RefreshCw, Loader2, Search, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Review = {
  id: string
  reviewer_name: string
  review_text: string
  rating: number
  source: string
  is_active: boolean
  sort_order: number
  author_photo_url: string | null
  google_profile_url: string | null
  google_review_id: string | null
  publish_time: string | null
  language: string | null
  created_at: string
}

type GoogleConfig = {
  place_id: string
  place_name: string | null
  overall_rating: number | null
  total_reviews: number | null
  last_synced_at: string | null
}

export default function AdminReviewsPage() {
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
        if (d.overall_rating || d.total_reviews) {
          setConfig(prev => ({
            ...prev,
            place_id: prev?.place_id ?? '',
            place_name: prev?.place_name ?? null,
            overall_rating: d.overall_rating ?? prev?.overall_rating ?? null,
            total_reviews: d.total_reviews ?? prev?.total_reviews ?? null,
            last_synced_at: new Date().toISOString(),
          }))
        }
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
        // Revert on failure
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

  // ── Stats ────────────────────────────────────────────────────────────────────

  const googleReviews = reviews.filter(r => r.source === 'google')
  const activeReviews = reviews.filter(r => r.is_active)

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Reviews</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage customer reviews from Google and other sources.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchReviews} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync Google
          </Button>
        </div>
      </div>

      {/* Google stats bar */}
      {config && (
        <div className="bg-white rounded-xl border border-zinc-200 px-6 py-4 flex flex-wrap items-center gap-6">
          {config.place_name && (
            <div>
              <p className="text-xs text-zinc-400">Google Place</p>
              <p className="text-sm font-medium text-zinc-900">{config.place_name}</p>
            </div>
          )}
          {config.overall_rating && (
            <div>
              <p className="text-xs text-zinc-400">Google Rating</p>
              <p className="text-sm font-medium text-zinc-900 flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {config.overall_rating.toFixed(1)}
              </p>
            </div>
          )}
          {config.total_reviews && (
            <div>
              <p className="text-xs text-zinc-400">Total Google Reviews</p>
              <p className="text-sm font-medium text-zinc-900">{config.total_reviews}</p>
            </div>
          )}
          {config.last_synced_at && (
            <div>
              <p className="text-xs text-zinc-400">Last Synced</p>
              <p className="text-sm text-zinc-600">
                {new Date(config.last_synced_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Place search (for initial setup) */}
      {!config?.place_id && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 space-y-3">
          <p className="text-sm text-amber-800 font-medium">
            No Google Place configured yet. Search for your business to get started.
          </p>
          <div className="flex gap-2">
            <input
              className="flex-1 text-sm border border-amber-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
              placeholder='e.g. "Off Course Amsterdam"'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePlaceSearch()}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handlePlaceSearch}
              disabled={searching || !searchQuery.trim()}
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Search
            </Button>
          </div>
          {searchResult && (
            <div className="flex items-center gap-3 bg-white rounded-lg border border-amber-200 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-900">{searchResult.name}</p>
                <p className="text-xs text-zinc-400 font-mono">{searchResult.placeId}</p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setConfig({
                    place_id: searchResult.placeId,
                    place_name: searchResult.name,
                    overall_rating: null,
                    total_reviews: null,
                    last_synced_at: null,
                  })
                  handleSync()
                }}
              >
                Use & Sync
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Sync result message */}
      {syncResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          syncResult.startsWith('Error')
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          {syncResult}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Quick stats */}
      <div className="flex gap-4 text-sm text-zinc-500">
        <span>{reviews.length} total</span>
        <span>{activeReviews.length} active</span>
        <span>{googleReviews.length} from Google</span>
      </div>

      {/* Loading */}
      {loading && reviews.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading reviews...
        </div>
      )}

      {/* Empty state */}
      {!loading && reviews.length === 0 && !error && (
        <div className="text-center py-16 text-zinc-400 text-sm space-y-2">
          <Star className="w-8 h-8 mx-auto text-zinc-200" />
          <p>No reviews yet. Click &quot;Sync Google&quot; to import reviews.</p>
        </div>
      )}

      {/* Reviews list */}
      {reviews.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <ul className="divide-y divide-zinc-100">
            {reviews.map(review => (
              <li key={review.id} className="px-6 py-4 flex items-start gap-4">
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
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${
                            i < review.rating
                              ? 'fill-amber-400 text-amber-400'
                              : 'fill-zinc-200 text-zinc-200'
                          }`}
                        />
                      ))}
                    </div>
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
                  <p className="text-sm text-zinc-600 leading-relaxed line-clamp-3">
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
                      onChange={() => toggleActive(review)}
                      className="w-4 h-4 accent-zinc-900"
                    />
                    <span className="text-xs text-zinc-500">Active</span>
                  </label>
                  <button
                    onClick={() => handleDelete(review)}
                    className="text-zinc-300 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
