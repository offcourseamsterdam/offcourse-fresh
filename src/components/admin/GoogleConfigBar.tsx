'use client'

import { Star, MessageSquare, MapPin, ExternalLink, HelpCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ReviewsConfig } from '@/app/[locale]/admin/reviews/types'
import { DEFAULT_ENGLISH_SMS_TEMPLATE } from '@/lib/sms/format-message'

interface Props {
  config: ReviewsConfig
  onSave: (updates: {
    placeId: string
    tripadvisorUrl?: string
    withlocalsShortId?: string
    recommendationsMapUrl?: string
    tripadvisorReviewUrlShared?: string
    tripadvisorReviewUrlPrivate?: string
    reviewSmsTemplate?: string
    reviewSmsAutoSend?: boolean
    reviewSmsEnabled?: boolean
  }) => Promise<boolean>
}

export function GoogleConfigBar({ config, onSave }: Props) {
  const [editing, setEditing] = useState(false)
  const [placeId, setPlaceId] = useState(config.place_id ?? '')
  const [taUrl, setTaUrl] = useState(config.tripadvisor_url ?? '')
  const [taReviewUrlShared, setTaReviewUrlShared] = useState(config.tripadvisor_review_url_shared ?? '')
  const [taReviewUrlPrivate, setTaReviewUrlPrivate] = useState(config.tripadvisor_review_url_private ?? '')
  const [mapUrl, setMapUrl] = useState(config.recommendations_map_url ?? '')
  const [wlShortId, setWlShortId] = useState(config.withlocals_experience_short_id ?? '')
  const [smsTemplate, setSmsTemplate] = useState(config.review_sms_template ?? '')
  const [smsEnabled, setSmsEnabled] = useState(config.review_sms_enabled ?? true)
  const [autoSend, setAutoSend] = useState(config.review_sms_auto_send ?? false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const ok = await onSave({
      placeId: placeId.trim(),
      tripadvisorUrl: taUrl.trim(),
      withlocalsShortId: wlShortId.trim(),
      recommendationsMapUrl: mapUrl.trim(),
      tripadvisorReviewUrlShared: taReviewUrlShared.trim(),
      tripadvisorReviewUrlPrivate: taReviewUrlPrivate.trim(),
      reviewSmsTemplate: smsTemplate.trim(),
      reviewSmsEnabled: smsEnabled,
      reviewSmsAutoSend: autoSend,
    })
    setSaving(false)
    if (ok) setEditing(false)
  }

  function insertToken(token: string) {
    setSmsTemplate(prev => {
      const current = prev || DEFAULT_ENGLISH_SMS_TEMPLATE
      return current + (current.endsWith(' ') || current.endsWith('\n') ? '' : ' ') + token
    })
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
        <div>
          <p className="text-xs text-zinc-400">Post-Cruise SMS</p>
          <p className="text-sm font-medium text-zinc-900 flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${config.review_sms_enabled ? (config.review_sms_auto_send ? 'bg-emerald-500' : 'bg-blue-500') : 'bg-zinc-300'}`} />
            {config.review_sms_enabled
              ? config.review_sms_auto_send
                ? '⚡ Auto-Send Active'
                : '📩 Slack Proposal Mode'
              : 'Disabled'}
          </p>
        </div>
        {config.last_synced_at && (
          <div>
            <p className="text-xs text-zinc-400">Last Synced</p>
            <p className="text-sm text-zinc-600">{new Date(config.last_synced_at).toLocaleString()}</p>
          </div>
        )}
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : 'Edit config & SMS'}
          </Button>
        </div>
      </div>

      {/* Config editor */}
      {editing && (
        <div className="px-6 py-5 space-y-5 bg-zinc-50 border-t border-zinc-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">Google Place ID</label>
              <input
                className="w-full text-sm border border-zinc-200 bg-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                placeholder="ChIJ… or Google Maps URL"
                value={placeId}
                onChange={e => setPlaceId(e.target.value)}
              />
              <p className="text-[10px] text-zinc-400 mt-0.5">Google Maps place_id for review scraping.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">Withlocals Experience Short ID</label>
              <input
                className="w-full text-sm border border-zinc-200 bg-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                placeholder="e.g. abc123"
                value={wlShortId}
                onChange={e => setWlShortId(e.target.value)}
              />
              <p className="text-[10px] text-zinc-400 mt-0.5">Short ID from your Withlocals experience URL.</p>
            </div>
          </div>

          <div className="border-t border-zinc-200/60 pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Branded Short Link Destinations (`/r/*`)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1">
                  Recommendations Map URL <span className="text-zinc-400">(/r/map)</span>
                </label>
                <input
                  className="w-full text-sm border border-zinc-200 bg-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                  placeholder="https://maps.app.goo.gl/..."
                  value={mapUrl}
                  onChange={e => setMapUrl(e.target.value)}
                />
                <p className="text-[10px] text-zinc-400 mt-0.5">Curated Google Maps list of local Amsterdam food & drink favorites.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1">
                  TripAdvisor Review URL — Shared <span className="text-zinc-400">(/r/review)</span>
                </label>
                <input
                  className="w-full text-sm border border-zinc-200 bg-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                  placeholder="https://www.tripadvisor.com/UserReviewEdit-..."
                  value={taReviewUrlShared}
                  onChange={e => setTaReviewUrlShared(e.target.value)}
                />
                <p className="text-[10px] text-zinc-400 mt-0.5">Direct &quot;write a review&quot; link for the shared-cruise TripAdvisor listing.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-700 block mb-1">
                  TripAdvisor Review URL — Private <span className="text-zinc-400">(/r/review)</span>
                </label>
                <input
                  className="w-full text-sm border border-zinc-200 bg-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                  placeholder="https://www.tripadvisor.com/UserReviewEdit-..."
                  value={taReviewUrlPrivate}
                  onChange={e => setTaReviewUrlPrivate(e.target.value)}
                />
                <p className="text-[10px] text-zinc-400 mt-0.5">Direct &quot;write a review&quot; link for the private-cruise TripAdvisor listing. /r/review resolves to one or the other based on the guest&apos;s booking category.</p>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-zinc-700 block mb-1">TripAdvisor Listing Profile URL</label>
                <input
                  className="w-full text-sm border border-zinc-200 bg-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                  placeholder="https://www.tripadvisor.com/Attraction_Review-..."
                  value={taUrl}
                  onChange={e => setTaUrl(e.target.value)}
                />
                <p className="text-[10px] text-zinc-400 mt-0.5">Listing URL for Outscraper review sync.</p>
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-200/60 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Post-Cruise SMS Follow-Up
              </h4>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smsEnabled}
                    onChange={e => setSmsEnabled(e.target.checked)}
                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400"
                  />
                  <span>Enable SMS feature</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSend}
                    onChange={e => setAutoSend(e.target.checked)}
                    disabled={!smsEnabled}
                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 disabled:opacity-50"
                  />
                  <span className={!smsEnabled ? 'text-zinc-400' : ''}>⚡ Auto-send on cruise completion (no Slack gate)</span>
                </label>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-700">SMS Message Template (Always in English)</label>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-zinc-400 mr-1">Insert token:</span>
                  {['{firstName}', '{listingTitle}', '{mapUrl}', '{reviewUrl}'].map(tok => (
                    <button
                      key={tok}
                      type="button"
                      onClick={() => insertToken(tok)}
                      className="text-[10px] bg-white border border-zinc-200 hover:border-zinc-400 px-1.5 py-0.5 rounded text-zinc-600 font-mono transition-colors"
                    >
                      {tok}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSmsTemplate(DEFAULT_ENGLISH_SMS_TEMPLATE)}
                    className="text-[10px] text-zinc-500 hover:text-zinc-800 underline ml-2"
                  >
                    Reset default
                  </button>
                </div>
              </div>
              <textarea
                rows={5}
                className="w-full text-sm font-mono border border-zinc-200 bg-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                placeholder={DEFAULT_ENGLISH_SMS_TEMPLATE}
                value={smsTemplate}
                onChange={e => setSmsTemplate(e.target.value)}
              />
              <p className="text-[10px] text-zinc-400 mt-1">
                Leave blank to use hardcoded English brand default. Brand tokens `{'{mapUrl}'}` and `{'{reviewUrl}'}` resolve to `/r/map` and `/r/review`.
              </p>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <Button size="sm" onClick={handleSave} disabled={saving || !placeId.trim()}>
              {saving ? 'Saving…' : 'Save all configuration'}
            </Button>
            <span className="text-xs text-zinc-400">Settings save to database instantly.</span>
          </div>
        </div>
      )}
    </div>
  )
}
