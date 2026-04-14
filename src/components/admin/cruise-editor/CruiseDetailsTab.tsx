'use client'

import { useState } from 'react'
import { CruiseTabProps, patchListing, inputCls } from './shared'
import { Field } from './Field'
import { TabSaveButton } from './TabSaveButton'

export function CruiseDetailsTab({ listing, onSave }: CruiseTabProps) {
  const [form, setForm] = useState({
    title: listing.title ?? '',
    tagline: listing.tagline ?? '',
    description: listing.description ?? '',
    category: listing.category ?? 'private',
    departure_location: listing.departure_location ?? '',
    google_maps_url: listing.google_maps_url ?? '',
    duration_display: listing.duration_display ?? '',
    max_guests: listing.max_guests?.toString() ?? '',
    fareharbor_item_pk: listing.fareharbor_item_pk?.toString() ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, {
      ...form,
      max_guests: form.max_guests ? Number(form.max_guests) : null,
      fareharbor_item_pk: form.fareharbor_item_pk ? Number(form.fareharbor_item_pk) : null,
    })
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <Field label="Title">
        <input
          className={inputCls}
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        />
      </Field>
      <Field label="Tagline">
        <input
          className={inputCls}
          value={form.tagline}
          onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
          placeholder="A short punchy line"
        />
      </Field>
      <Field label="Description">
        <textarea
          className={`${inputCls} min-h-[140px] resize-y`}
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </Field>
      <Field label="Category">
        <div className="flex gap-2">
          {['private', 'shared', 'standard'].map(cat => (
            <button
              key={cat}
              onClick={() => setForm(f => ({ ...f, category: cat }))}
              className={`px-3 py-1.5 rounded-md border text-xs capitalize transition-all ${
                form.category === cat
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-200 bg-white hover:border-zinc-400'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Departure location">
        <input
          className={inputCls}
          value={form.departure_location}
          onChange={e => setForm(f => ({ ...f, departure_location: e.target.value }))}
          placeholder="e.g. Brouwersgracht 29"
        />
      </Field>
      <Field label="Google Maps URL">
        <input
          className={inputCls}
          value={form.google_maps_url}
          onChange={e => setForm(f => ({ ...f, google_maps_url: e.target.value }))}
          placeholder="https://www.google.com/maps/embed?pb=..."
        />
        <p className="text-xs text-zinc-400 mt-1">
          Paste a Google Maps embed URL. Go to Google Maps &rarr; Share &rarr; Embed a map &rarr; copy the src URL.
        </p>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration display">
          <input
            className={inputCls}
            value={form.duration_display}
            onChange={e => setForm(f => ({ ...f, duration_display: e.target.value }))}
            placeholder="e.g. 1.5 hours"
          />
        </Field>
        <Field label="Max guests">
          <input
            className={inputCls}
            type="number"
            value={form.max_guests}
            onChange={e => setForm(f => ({ ...f, max_guests: e.target.value }))}
            placeholder="8"
          />
        </Field>
      </div>
      <Field label="FareHarbor item PK">
        <input
          className={inputCls}
          type="number"
          value={form.fareharbor_item_pk}
          onChange={e => setForm(f => ({ ...f, fareharbor_item_pk: e.target.value }))}
          placeholder="e.g. 12345"
        />
        <p className="text-xs text-zinc-400 mt-1">
          The FareHarbor product ID this listing connects to. Find it in your FareHarbor dashboard under Items.
        </p>
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
