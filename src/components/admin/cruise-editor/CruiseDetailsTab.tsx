'use client'

import { useEffect, useState } from 'react'
import { CruiseTabProps, patchListing, inputCls } from './shared'
import { Field } from './Field'
import { TabSaveButton } from './TabSaveButton'
import { RichTextEditor } from '@/components/admin/RichTextEditor'

interface FHItem {
  fareharbor_pk: number
  name: string
}

export function CruiseDetailsTab({ listing, onSave }: CruiseTabProps) {
  const [form, setForm] = useState({
    title: listing.title ?? '',
    slug: listing.slug ?? '',
    tagline: listing.tagline ?? '',
    description: listing.description ?? '',
    category: listing.category ?? 'private',
    departure_location: listing.departure_location ?? '',
    google_maps_url: listing.google_maps_url ?? '',
    duration_display: listing.duration_display ?? '',
    max_guests: listing.max_guests?.toString() ?? '',
    fareharbor_item_pk: listing.fareharbor_item_pk?.toString() ?? '',
    booking_cutoff_hours: listing.booking_cutoff_hours?.toString() ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fhItems, setFhItems] = useState<FHItem[]>([])

  // Load FH items once so we can show the item name next to its PK
  useEffect(() => {
    fetch('/api/admin/fareharbor-items')
      .then(r => r.json())
      .then(json => {
        const list = json?.data?.items
        if (Array.isArray(list)) setFhItems(list)
      })
      .catch(() => {})
  }, [])

  const fhItemName = (() => {
    const pk = Number(form.fareharbor_item_pk)
    if (!pk) return null
    return fhItems.find(i => i.fareharbor_pk === pk)?.name ?? null
  })()

  async function save() {
    setSaving(true)
    setError(null)
    const json = await patchListing(listing.id, {
      ...form,
      max_guests: form.max_guests ? Number(form.max_guests) : null,
      fareharbor_item_pk: form.fareharbor_item_pk ? Number(form.fareharbor_item_pk) : null,
      booking_cutoff_hours: form.booking_cutoff_hours ? Number(form.booking_cutoff_hours) : null,
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
      <Field label="Slug (URL)">
        <input
          className={inputCls}
          value={form.slug}
          onChange={e => {
            // Normalize on the fly: lowercase, replace whitespace with dashes,
            // strip anything that isn't a-z, 0-9, or '-'.
            const cleaned = e.target.value
              .toLowerCase()
              .replace(/\s+/g, '-')
              .replace(/[^a-z0-9-]/g, '')
            setForm(f => ({ ...f, slug: cleaned }))
          }}
          placeholder="e.g. private-hidden-gems-cruise"
        />
        <p className="text-xs text-amber-700 mt-1">
          ⚠ Changing the slug breaks the existing URL. Old links and SEO rankings
          will 404. Only change this before the page is published or if you can
          set up a redirect.
        </p>
        {form.slug && (
          <p className="text-xs text-zinc-400 mt-1">
            URL: <span className="font-mono">offcourseamsterdam.com/cruises/{form.slug}</span>
          </p>
        )}
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
        <RichTextEditor
          value={form.description}
          onChange={html => setForm(f => ({ ...f, description: html }))}
          placeholder="The story behind this cruise…"
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
        {form.fareharbor_item_pk && fhItemName && (
          <p className="text-xs text-emerald-700 mt-1.5">
            ✓ <span className="font-medium">{fhItemName}</span>
          </p>
        )}
        {form.fareharbor_item_pk && fhItems.length > 0 && !fhItemName && (
          <p className="text-xs text-amber-700 mt-1.5">
            ⚠ No FareHarbor item with this PK in our database. Run the FH sync or double-check the ID.
          </p>
        )}
        <p className="text-xs text-zinc-400 mt-1">
          The FareHarbor product ID this listing connects to. Find it in your FareHarbor dashboard under Items.
        </p>
      </Field>
      <Field label="Booking cutoff (hours)">
        <input
          className={inputCls}
          type="number"
          min={0}
          step={1}
          value={form.booking_cutoff_hours}
          onChange={e => setForm(f => ({ ...f, booking_cutoff_hours: e.target.value }))}
          placeholder="e.g. 24 — leave empty to use FH item default"
        />
        <p className="text-xs text-zinc-400 mt-1">
          Slots within this many hours of departure show &ldquo;Chat to book&rdquo; instead of the checkout button.
          Leave empty to fall back to the FareHarbor item&apos;s default cutoff.
        </p>
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
