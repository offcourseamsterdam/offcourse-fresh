'use client'

import { Loader2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_TIERS, type CancellationTier } from '@/lib/cancellation/policy'

interface CancellationTiersEditorProps {
  /** Current value from `fareharbor_items.cancellation_tiers` (raw JSONB or null). */
  value: CancellationTier[] | null
  /** Persists the new tiers. Should resolve when the DB write is complete. */
  onSave: (tiers: CancellationTier[]) => Promise<void> | void
  saving?: boolean
}

/**
 * Compact editor for `fareharbor_items.cancellation_tiers`.
 * Renders one row per tier — hours_before + refund_percent + ✕.
 *
 * Validation on save: hours strictly descending, percent 0–100, at least one row.
 */
export function CancellationTiersEditor({ value, onSave, saving }: CancellationTiersEditorProps) {
  // Use DEFAULT_TIERS as starter when null/empty so editor is never empty.
  const [tiers, setTiers] = useState<CancellationTier[]>(
    value && value.length > 0 ? value : DEFAULT_TIERS
  )
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  function update(idx: number, field: keyof CancellationTier, raw: string) {
    const next = [...tiers]
    const num = raw === '' ? 0 : Number(raw)
    next[idx] = { ...next[idx], [field]: Number.isFinite(num) ? num : 0 }
    setTiers(next)
    setDirty(true)
    setError(null)
  }

  function remove(idx: number) {
    setTiers(tiers.filter((_, i) => i !== idx))
    setDirty(true)
    setError(null)
  }

  function add() {
    // Pick a sensible default: half the smallest existing hours_before, or 12.
    const lowest = tiers.length > 0 ? tiers[tiers.length - 1].hours_before : 24
    const newHours = Math.max(0, Math.floor(lowest / 2))
    setTiers([...tiers, { hours_before: newHours, refund_percent: 0 }])
    setDirty(true)
    setError(null)
  }

  function reset() {
    setTiers(DEFAULT_TIERS)
    setDirty(true)
    setError(null)
  }

  function validate(): string | null {
    if (tiers.length === 0) return 'At least one tier is required.'
    for (const t of tiers) {
      if (!Number.isFinite(t.hours_before) || t.hours_before < 0) {
        return 'Hours before departure must be 0 or higher.'
      }
      if (!Number.isFinite(t.refund_percent) || t.refund_percent < 0 || t.refund_percent > 100) {
        return 'Refund percent must be between 0 and 100.'
      }
    }
    // Strictly descending by hours_before
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].hours_before >= tiers[i - 1].hours_before) {
        return 'Tiers must be in descending order by "hours before".'
      }
    }
    return null
  }

  async function save() {
    const err = validate()
    if (err) {
      setError(err)
      return
    }
    await onSave(tiers)
    setDirty(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-zinc-700">Cancellation policy</h3>
        <button
          type="button"
          onClick={reset}
          className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          Reset to default
        </button>
      </div>

      {/* Header row */}
      <div className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
        <span>Hours before departure</span>
        <span>Refund %</span>
        <span></span>
      </div>

      {/* Tier rows */}
      <div className="space-y-2">
        {tiers.map((tier, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center">
            <input
              type="number"
              min={0}
              value={tier.hours_before}
              onChange={e => update(idx, 'hours_before', e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/20"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={tier.refund_percent}
              onChange={e => update(idx, 'refund_percent', e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900/20"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              aria-label="Remove tier"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add tier
      </button>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving}
        className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
      >
        {saving && <Loader2 className="w-3 h-3 animate-spin" />}
        {saving ? 'Saving…' : dirty ? 'Save policy' : 'Saved'}
      </button>
    </div>
  )
}
