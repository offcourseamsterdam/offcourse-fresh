'use client'

import { Star, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReviewItem } from '@/components/admin/ReviewItem'
import { GoogleConfigBar } from '@/components/admin/GoogleConfigBar'
import { PlaceSearch } from '@/components/admin/PlaceSearch'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useReviews } from './useReviews'
import { useReplyEditor } from './useReplyEditor'

export default function AdminReviewsPage() {
  const {
    reviews,
    loading,
    error,
    config,
    setConfig,
    syncing,
    syncResult,
    handleSync,
    fetchReviews,
    searchQuery,
    setSearchQuery,
    searching,
    searchResult,
    handlePlaceSearch,
    toggleActive,
    handleDelete,
    updateReview,
    googleReviews,
    activeReviews,
    isGbpConnected,
  } = useReviews()

  const {
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
  } = useReplyEditor(updateReview)

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

      {/* Google stats bar + GBP connection */}
      {config && <GoogleConfigBar config={config} />}

      {/* Place search (for initial setup) */}
      {!config?.place_id && (
        <PlaceSearch
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searching={searching}
          searchResult={searchResult}
          onSearch={handlePlaceSearch}
          onSelectPlace={setConfig}
          onSync={handleSync}
        />
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

      <AdminErrorBanner error={error} />

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
              <ReviewItem
                key={review.id}
                review={review}
                isGbpConnected={isGbpConnected}
                replyingTo={replyingTo}
                replyText={replyText}
                replyError={replyError}
                replySubmitting={replySubmitting}
                generatingFor={generatingFor}
                onToggleActive={toggleActive}
                onDelete={handleDelete}
                onOpenReply={openReply}
                onCloseReply={closeReply}
                onReplyTextChange={setReplyText}
                onSubmitReply={submitReply}
                onDeleteReply={deleteReply}
                onGenerateReply={generateAiReply}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
