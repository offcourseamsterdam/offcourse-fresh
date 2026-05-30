'use client'

import { useState } from 'react'
import { Star, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReviewItem } from '@/components/admin/ReviewItem'
import { GoogleConfigBar } from '@/components/admin/GoogleConfigBar'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useReviews } from './useReviews'

type SourceFilter = 'all' | 'google' | 'tripadvisor'

export default function AdminReviewsPage() {
  const {
    reviews,
    loading,
    error,
    config,
    syncing,
    syncResult,
    handleSync,
    fetchReviews,
    saveConfig,
    toggleActive,
    handleDelete,
    googleReviews,
    taReviews,
    activeReviews,
  } = useReviews()

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  const hasGoogle = googleReviews.length > 0
  const hasTa = taReviews.length > 0
  const showTabs = hasGoogle && hasTa

  const filteredReviews = sourceFilter === 'all'
    ? reviews
    : reviews.filter(r => r.source === (sourceFilter === 'google' ? 'google' : 'tripadvisor'))

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Reviews</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage customer reviews from Google and TripAdvisor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchReviews} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={handleSync} disabled={syncing || !config?.place_id}>
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync
          </Button>
        </div>
      </div>

      {/* Config bar */}
      {config && <GoogleConfigBar config={config} onSave={saveConfig} />}

      {/* No config yet */}
      {!config && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 text-sm text-amber-800">
          No reviews config yet. Click <strong>Edit config</strong> above to add your Google place ID.
        </div>
      )}

      {/* Sync result */}
      {syncResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          syncResult.startsWith('Error')
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-green-200 bg-green-50 text-green-700'
        }`}>
          {syncResult}
        </div>
      )}

      <AdminErrorBanner error={error} />

      {/* Quick stats */}
      <div className="flex gap-4 text-sm text-zinc-500">
        <span>{reviews.length} total</span>
        <span>{activeReviews.length} active</span>
        {googleReviews.length > 0 && <span>{googleReviews.length} Google</span>}
        {taReviews.length > 0 && <span>{taReviews.length} TripAdvisor</span>}
      </div>

      {/* Source filter tabs */}
      {showTabs && (
        <div className="flex gap-1 border-b border-zinc-200">
          {(['all', 'google', 'tripadvisor'] as SourceFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                sourceFilter === f
                  ? 'border-zinc-900 text-zinc-900'
                  : 'border-transparent text-zinc-400 hover:text-zinc-600'
              }`}
            >
              {f === 'all' ? 'All' : f === 'google' ? '⭐ Google' : '🦉 TripAdvisor'}
            </button>
          ))}
        </div>
      )}

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
          <p>No reviews yet. Click <strong>Sync</strong> to import reviews from Outscraper.</p>
        </div>
      )}

      {/* Reviews list */}
      {filteredReviews.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <ul className="divide-y divide-zinc-100">
            {filteredReviews.map(review => (
              <ReviewItem
                key={review.id}
                review={review}
                onToggleActive={toggleActive}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
