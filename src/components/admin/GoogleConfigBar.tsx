'use client'

import { Star } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ReviewsConfig } from '@/app/[locale]/admin/reviews/types'

interface Props {
  config: ReviewsConfig
  onSave: (placeId: string, tripadvisorUrl: string, withlocalsShortId: string) => Promise<boolean>
}

export function GoogleConfigBar({ config, onSave }: Props) {
  const [editing, setEditing] = useState(false)
  const [placeId, setPlaceId] = useState(config.place_id ?? '')
  const [taUrl, setTaUrl] = useState(config.tripadvisor_url ?? '')
  const [wlShortId, setWlShortId] = useState(config.withlocals_experience_short_id ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const ok = await onSave(placeId.trim(), taUrl.trim(), wlShortId.trim())
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      {/* Stats row */}
      <div className="px-6 py-4 flex flex-wrap items-center gap-6 border-b border-zinc-100">
        {config.place_name && (
          <div>
            <p className="text-xs text-zinc-400">Google Place</p>
            <p className="text-sm font-medium text-zinc-900">{config.place_name}</p>
          </div>
        )}
        {config.overall_rating != null && (
          <div>
            <p className="text-xs text-zinc-400">Google Rating</p>
            <p className="text-sm font-medium text-zinc-900 flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              {config.overall_rating.toFixed(1)}
              {config.total_reviews != null && (
                <span className="text-zinc-400 font-normal">({config.total_reviews})</span>
              )}
            </p>
          </div>
        )}
        {config.tripadvisor_rating != null && (
          <div>
            <p className="text-xs text-zinc-400">TripAdvisor Rating</p>
            <p className="text-sm font-medium text-zinc-900 flex items-center gap-1">
              🦉 {config.tripadvisor_rating.toFixed(1)}
            </p>
          </div>
        )}
        {config.last_synced_at && (
          <div>
            <p className="text-xs text-zinc-400">Last Synced</p>
            <p className="text-sm text-zinc-600">{new Date(config.last_synced_at).toLocaleString()}</p>
          </div>
        )}
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : 'Edit config'}
          </Button>
        </div>
      </div>

      {/* Config editor */}
      {editing && (
        <div className="px-6 py-4 space-y-3 bg-zinc-50">
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">Google Place ID</label>
            <input
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300"
              placeholder="ChIJ… or Google Maps URL"
              value={placeId}
              onChange={e => setPlaceId(e.target.value)}
            />
            <p className="text-[10px] text-zinc-400 mt-0.5">Find it in Google Maps → Share → copy the place_id parameter</p>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">TripAdvisor listing URL</label>
            <input
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300"
              placeholder="https://www.tripadvisor.com/Attraction_Review-…"
              value={taUrl}
              onChange={e => setTaUrl(e.target.value)}
            />
            <p className="text-[10px] text-zinc-400 mt-0.5">Full URL from your TripAdvisor listing page. Leave blank to skip TripAdvisor.</p>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">Withlocals experience short ID</label>
            <input
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300"
              placeholder="e.g. abc123"
              value={wlShortId}
              onChange={e => setWlShortId(e.target.value)}
            />
            <p className="text-[10px] text-zinc-400 mt-0.5">Short ID from your Withlocals experience URL. Leave blank to skip Withlocals.</p>
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving || !placeId.trim()}>
            {saving ? 'Saving…' : 'Save config'}
          </Button>
        </div>
      )}
    </div>
  )
}
