'use client'

import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GoogleConfig } from '@/app/[locale]/admin/reviews/types'

interface PlaceSearchProps {
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  searching: boolean
  searchResult: { placeId: string; name: string } | null
  onSearch: () => void
  onSelectPlace: (config: GoogleConfig) => void
  onSync: () => void
}

export function PlaceSearch({
  searchQuery,
  onSearchQueryChange,
  searching,
  searchResult,
  onSearch,
  onSelectPlace,
  onSync,
}: PlaceSearchProps) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 space-y-3">
      <p className="text-sm text-amber-800 font-medium">
        No Google Place configured yet. Search for your business to get started.
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 text-sm border border-amber-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
          placeholder='e.g. "Off Course Amsterdam"'
          value={searchQuery}
          onChange={e => onSearchQueryChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSearch()}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={onSearch}
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
              onSelectPlace({
                place_id: searchResult.placeId,
                place_name: searchResult.name,
                overall_rating: null,
                total_reviews: null,
                last_synced_at: null,
                is_gbp_connected: false,
                oauth_email: null,
                oauth_connected_at: null,
              })
              onSync()
            }}
          >
            Use & Sync
          </Button>
        </div>
      )}
    </div>
  )
}
