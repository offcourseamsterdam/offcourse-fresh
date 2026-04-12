'use client'

import { Star, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { GoogleConfig } from '@/app/[locale]/admin/reviews/types'

interface GoogleConfigBarProps {
  config: GoogleConfig
}

export function GoogleConfigBar({ config }: GoogleConfigBarProps) {
  return (
    <>
      {/* Google stats bar */}
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

      {/* Google Business Profile connection */}
      {config.is_gbp_connected ? (
        <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-4 flex items-center gap-4">
          <Link2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800">
              Google Business Profile connected
            </p>
            <p className="text-xs text-green-600">
              {config.oauth_email} — you can reply to reviews directly from here
            </p>
          </div>
          <Badge variant="success" className="text-xs">Connected</Badge>
        </div>
      ) : (
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-6 py-4 flex items-center gap-4">
          <Link2 className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-zinc-700">
              Connect Google Business Profile to reply to reviews
            </p>
            <p className="text-xs text-zinc-500">
              One-time authorization — log in with the Google account that owns your business listing.
            </p>
          </div>
          <a href="/api/admin/reviews/google-auth">
            <Button size="sm" variant="outline">
              Connect Google
            </Button>
          </a>
        </div>
      )}
    </>
  )
}
