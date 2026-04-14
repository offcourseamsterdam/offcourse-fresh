'use client'

import { useState } from 'react'
import { CruiseTabProps, patchListing, inputCls } from './shared'
import { TabSaveButton } from './TabSaveButton'

export function CruiseCancellationTab({ listing, onSave }: CruiseTabProps) {
  const [cancellationPolicy, setCancellationPolicy] = useState(
    (listing.cancellation_policy as { text?: string } | null)?.text ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, {
      cancellation_policy: { text: cancellationPolicy },
    })
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-600">Cancellation policy</label>
        <textarea
          className={`${inputCls} min-h-[100px] resize-y`}
          value={cancellationPolicy}
          onChange={e => setCancellationPolicy(e.target.value)}
          placeholder="Free cancellation up to 48 hours before departure…"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
