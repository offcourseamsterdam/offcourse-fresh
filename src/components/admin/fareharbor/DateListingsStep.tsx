'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, ChevronRight } from 'lucide-react'
import { fmtTime, fmtPrice } from './helpers'
import type { Listing } from './types'

interface DateListingsStepProps {
  date: string
  onDateChange: (date: string) => void
  onPickListing: (listing: Listing) => void
}

export function DateListingsStep({ date, onDateChange, onPickListing }: DateListingsStepProps) {
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [loadingListings, setLoadingListings] = useState(false)
  const [listingsError, setListingsError] = useState<string | null>(null)

  async function searchListings() {
    setLoadingListings(true)
    setListingsError(null)
    setListings(null)
    try {
      const res = await fetch(`/api/admin/booking-flow?date=${date}`)
      const json = await res.json()
      if (json.ok) {
        setListings(json.data)
      } else {
        setListingsError(json.error ?? 'Failed to load listings')
      }
    } catch {
      setListingsError('Network error')
    } finally {
      setLoadingListings(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pick a date</CardTitle>
          <CardDescription className="text-xs">We'll show all cruise listings available on this day</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600">Date</label>
              <Input type="date" value={date} onChange={e => onDateChange(e.target.value)} className="w-44" />
            </div>
            <Button onClick={searchListings} disabled={loadingListings} size="sm">
              {loadingListings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {loadingListings ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {listingsError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {listingsError}
        </div>
      )}

      {listings && listings.length === 0 && (
        <p className="text-sm text-zinc-400 italic">No cruise listings found for this date.</p>
      )}

      {listings && listings.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">{listings.length} listing{listings.length !== 1 ? 's' : ''} — click one to continue</p>
          {listings.map(listing => (
            <button
              key={listing.id}
              onClick={() => onPickListing(listing)}
              className="w-full text-left p-4 rounded-lg border border-zinc-200 bg-white hover:border-zinc-400 hover:bg-zinc-50 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">{listing.title}</p>
                  {listing.tagline && (
                    <p className="text-xs text-zinc-400 mt-0.5 truncate">{listing.tagline}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {listing.slot_count > 0 ? (
                    <Badge variant="success">{listing.slot_count} slot{listing.slot_count !== 1 ? 's' : ''}</Badge>
                  ) : (
                    <Badge variant="secondary">No availability</Badge>
                  )}
                  {listing.starting_price && (
                    <span className="text-sm font-semibold text-zinc-700">
                      from {fmtPrice(listing.starting_price)}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-zinc-500 transition-colors" />
                </div>
              </div>
              {listing.slot_count > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {listing.slots.slice(0, 6).map(s => (
                    <span key={s.pk} className="text-xs bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded">
                      {fmtTime(s.start_at)}
                    </span>
                  ))}
                  {listing.slots.length > 6 && (
                    <span className="text-xs text-zinc-400">+{listing.slots.length - 6} more</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
