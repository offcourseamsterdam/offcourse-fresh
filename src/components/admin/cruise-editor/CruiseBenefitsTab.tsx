'use client'

import { useState } from 'react'
import { CruiseTabProps, patchListing } from './shared'
import { ListEditor } from './ListEditor'
import { TabSaveButton } from './TabSaveButton'

export function CruiseBenefitsTab({ listing, onSave }: CruiseTabProps) {
  const [benefits, setBenefits] = useState<Array<{ text: string }>>(
    Array.isArray(listing.benefits) ? listing.benefits : []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, { benefits })
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <ListEditor
        label="Benefits"
        items={benefits}
        onChange={setBenefits}
        placeholder="e.g. Free drinks included"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
