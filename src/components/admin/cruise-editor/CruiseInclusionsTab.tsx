'use client'

import { useState } from 'react'
import { CruiseTabProps, patchListing } from './shared'
import { ListEditor } from './ListEditor'
import { TabSaveButton } from './TabSaveButton'

export function CruiseInclusionsTab({ listing, onSave }: CruiseTabProps) {
  const [inclusions, setInclusions] = useState<Array<{ text: string }>>(
    Array.isArray(listing.inclusions) ? listing.inclusions : []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, { inclusions })
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <ListEditor
        label="Inclusions"
        items={inclusions}
        onChange={setInclusions}
        placeholder="e.g. Bluetooth speaker"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
