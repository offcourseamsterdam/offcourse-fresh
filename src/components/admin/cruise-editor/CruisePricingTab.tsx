'use client'

import { useState } from 'react'
import { CruiseTabProps, patchListing, inputCls } from './shared'
import { Field } from './Field'
import { TabSaveButton } from './TabSaveButton'

export function CruisePricingTab({ listing, onSave }: CruiseTabProps) {
  const [form, setForm] = useState({
    starting_price: listing.starting_price?.toString() ?? '',
    price_display: listing.price_display ?? '',
    price_label: listing.price_label ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, {
      starting_price: form.starting_price ? Number(form.starting_price) : null,
      price_display: form.price_display,
      price_label: form.price_label,
    })
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-sm">
      <Field label="Starting price (€)">
        <input
          className={inputCls}
          type="number"
          value={form.starting_price}
          onChange={e => setForm(f => ({ ...f, starting_price: e.target.value }))}
          placeholder="165"
        />
        <p className="text-xs text-zinc-400 mt-1">Used for search results and structured data</p>
      </Field>
      <Field label="Price display text">
        <input
          className={inputCls}
          value={form.price_display}
          onChange={e => setForm(f => ({ ...f, price_display: e.target.value }))}
          placeholder="from €165"
        />
      </Field>
      <Field label="Price label">
        <input
          className={inputCls}
          value={form.price_label}
          onChange={e => setForm(f => ({ ...f, price_label: e.target.value }))}
          placeholder="per boat"
        />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
