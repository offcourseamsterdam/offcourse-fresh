'use client'

import { useState } from 'react'
import { CruiseTabProps, patchListing } from './shared'
import { FaqEditor } from './FaqEditor'
import { TabSaveButton } from './TabSaveButton'

export function CruiseFAQsTab({ listing, onSave }: CruiseTabProps) {
  const [faqs, setFaqs] = useState<Array<{ question: string; answer: string }>>(
    Array.isArray(listing.faqs) ? listing.faqs : []
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, { faqs })
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <FaqEditor faqs={faqs} onChange={setFaqs} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
