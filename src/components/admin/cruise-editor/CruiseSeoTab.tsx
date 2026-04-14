'use client'

import { useState } from 'react'
import { CruiseTabProps, patchListing, inputCls } from './shared'
import { Field } from './Field'
import { TabSaveButton } from './TabSaveButton'

export function CruiseSeoTab({ listing, onSave }: CruiseTabProps) {
  const [form, setForm] = useState({
    seo_title: listing.seo_title ?? '',
    seo_meta_description: listing.seo_meta_description ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, form)
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <Field label={`SEO title (${form.seo_title.length}/60)`}>
        <input
          className={inputCls}
          value={form.seo_title}
          onChange={e => setForm(f => ({ ...f, seo_title: e.target.value }))}
          placeholder="Private Canal Cruise Amsterdam — Off Course"
        />
        {form.seo_title.length > 60 && (
          <p className="text-xs text-amber-600 mt-1">
            Over 60 characters — Google may truncate this
          </p>
        )}
      </Field>
      <Field label={`Meta description (${form.seo_meta_description.length}/160)`}>
        <textarea
          className={`${inputCls} min-h-[100px] resize-y`}
          value={form.seo_meta_description}
          onChange={e => setForm(f => ({ ...f, seo_meta_description: e.target.value }))}
          placeholder="Explore Amsterdam's hidden canals on a private electric boat…"
        />
        {form.seo_meta_description.length > 160 && (
          <p className="text-xs text-amber-600 mt-1">
            Over 160 characters — Google may truncate this
          </p>
        )}
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
