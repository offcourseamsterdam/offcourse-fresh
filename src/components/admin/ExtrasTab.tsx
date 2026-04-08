'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Extra {
  id: string
  name: string
  description: string | null
  category: string
  scope: string
  applicable_categories: string[] | null
  price_type: string
  price_value: number
  is_required: boolean
  is_active: boolean
  sort_order: number
}

interface ExtrasTabProps {
  listingId: string
  listingCategory: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

import { CATEGORY_EMOJI, formatExtraPrice as formatPrice } from '@/lib/constants'

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      disabled={disabled}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-zinc-900/20',
        enabled ? 'bg-zinc-900' : 'bg-zinc-200',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
          enabled ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ExtrasTab({ listingId, listingCategory }: ExtrasTabProps) {
  const [resolvedExtras, setResolvedExtras] = useState<Extra[]>([])
  const [allExtras, setAllExtras] = useState<Extra[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null) // extra id being saved
  const [selectedPerListing, setSelectedPerListing] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [resolvedRes, allRes] = await Promise.all([
        fetch(`/api/admin/cruise-listings/${listingId}/extras?guestCount=1`),
        fetch('/api/admin/extras'),
      ])
      if (!resolvedRes.ok || !allRes.ok) {
        throw new Error('Failed to load extras data')
      }
      const resolvedJson = await resolvedRes.json()
      const allJson = await allRes.json()

      if (resolvedJson.ok) setResolvedExtras(resolvedJson.data?.extras ?? [])
      if (allJson.ok) setAllExtras(allJson.data?.extras ?? [])
    } catch {
      setError('Failed to load extras. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [listingId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function patchExtra(extraId: string, isEnabled: boolean): Promise<boolean> {
    setSaving(extraId)
    try {
      const res = await fetch(`/api/admin/cruise-listings/${listingId}/extras`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extraId, isEnabled }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Failed to update extra')
        return false
      }
      await fetchData()
      return true
    } catch {
      setError('Failed to update extra')
      return false
    } finally {
      setSaving(null)
    }
  }

  async function handleAddPerListing() {
    if (!selectedPerListing) return
    const ok = await patchExtra(selectedPerListing, true)
    if (ok) setSelectedPerListing('')
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-400 py-8">
        <Loader2 className="animate-spin w-4 h-4" /> Loading extras…
      </div>
    )
  }

  // Partition resolved extras by scope.
  // Note: enabled state is derived from the resolved extras list.
  // An extra absent from resolved means it was disabled for this listing via listing_extras.
  // This works correctly as long as the resolver endpoint doesn't filter for other reasons.
  const resolvedGlobalIds = new Set(resolvedExtras.filter(e => e.scope === 'global').map(e => e.id))
  const resolvedPerListing = resolvedExtras.filter(e => e.scope === 'per_listing')

  // All global extras applicable to this listing category (active only)
  const globalCatalog = allExtras.filter(
    e => e.scope === 'global' && e.is_active && e.applicable_categories?.includes(listingCategory)
  )

  // All per_listing extras not already added
  const perListingCatalog = allExtras.filter(
    e =>
      e.scope === 'per_listing' &&
      e.is_active &&
      !resolvedPerListing.some(r => r.id === e.id)
  )

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Section 1: Global Extras ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Global Extras</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Automatically applied based on cruise category. Toggle to disable for this listing.
          </p>
        </div>

        {globalCatalog.length === 0 ? (
          <p className="text-sm text-zinc-400 italic">
            No global extras configured for the <span className="font-medium">{listingCategory}</span> category.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
            {globalCatalog.map(extra => {
              const isEnabled = resolvedGlobalIds.has(extra.id)
              const isSaving = saving === extra.id
              return (
                <div
                  key={extra.id}
                  className="flex items-center justify-between px-4 py-3 bg-white hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg shrink-0" aria-hidden>
                      {CATEGORY_EMOJI[extra.category] ?? '📦'}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-zinc-900">{extra.name}</span>
                        {extra.is_required && (
                          <Badge variant="outline" className="text-xs py-0">Required</Badge>
                        )}
                      </div>
                      {extra.description && (
                        <p className="text-xs text-zinc-400 truncate mt-0.5">{extra.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-xs text-zinc-500 font-mono">{formatPrice(extra)}</span>
                    {isSaving ? (
                      <Loader2 className="animate-spin w-4 h-4 text-zinc-400" />
                    ) : (
                      <Toggle
                        enabled={isEnabled}
                        onToggle={() => patchExtra(extra.id, !isEnabled)}
                        disabled={extra.is_required}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Section 2: Per-listing Extras ────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Per-listing Extras</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Only appear on this specific listing.
          </p>
        </div>

        {resolvedPerListing.length === 0 ? (
          <p className="text-sm text-zinc-400 italic">No per-listing extras added yet.</p>
        ) : (
          <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
            {resolvedPerListing.map(extra => {
              const isSaving = saving === extra.id
              return (
                <div
                  key={extra.id}
                  className="flex items-center justify-between px-4 py-3 bg-white hover:bg-zinc-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg shrink-0" aria-hidden>
                      {CATEGORY_EMOJI[extra.category] ?? '📦'}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-zinc-900">{extra.name}</span>
                      </div>
                      {extra.description && (
                        <p className="text-xs text-zinc-400 truncate mt-0.5">{extra.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-xs text-zinc-500 font-mono">{formatPrice(extra)}</span>
                    {isSaving ? (
                      <Loader2 className="animate-spin w-4 h-4 text-zinc-400" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => patchExtra(extra.id, false)}
                        className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Remove from this listing"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Add per-listing extra */}
        {perListingCatalog.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={selectedPerListing}
              onChange={e => setSelectedPerListing(e.target.value)}
              className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/20 bg-white"
            >
              <option value="">Select an extra to add…</option>
              {perListingCatalog.map(extra => (
                <option key={extra.id} value={extra.id}>
                  {CATEGORY_EMOJI[extra.category] ?? ''} {extra.name} — {formatPrice(extra)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={handleAddPerListing}
              disabled={!selectedPerListing || saving !== null}
            >
              {saving !== null && selectedPerListing === saving ? (
                <Loader2 className="animate-spin w-3.5 h-3.5 mr-1" />
              ) : (
                <Plus className="w-3.5 h-3.5 mr-1" />
              )}
              Add
            </Button>
          </div>
        )}

        {perListingCatalog.length === 0 && resolvedPerListing.length === 0 && (
          <p className="text-xs text-zinc-400">
            No per-listing extras available in the catalog. Create some on the{' '}
            <a href="../extras" className="underline hover:text-zinc-700">Extras page</a>.
          </p>
        )}
      </section>
    </div>
  )
}
