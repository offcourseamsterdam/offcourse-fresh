'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { CruiseTabProps, patchListing, inputCls } from './shared'
import { Field } from './Field'
import { TabSaveButton } from './TabSaveButton'
import { RichTextEditor } from '@/components/admin/RichTextEditor'
import { useAdminFetch } from '@/hooks/useAdminFetch'

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
    chef_name: listing.chef_name ?? '',
    chef_bio: listing.chef_bio ?? '',
    theme_primary_color: listing.theme_primary_color ?? '',
    theme_accent_color: listing.theme_accent_color ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chefPhotoUrl, setChefPhotoUrl] = useState(listing.chef_photo_url ?? '')
  const [uploadingChefPhoto, setUploadingChefPhoto] = useState(false)
  const chefPhotoInputRef = useRef<HTMLInputElement>(null)

  async function uploadChefPhoto(file: File) {
    setUploadingChefPhoto(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/cruise-listings/${listing.id}/chef-photo`, { method: 'POST', body: fd })
      const json = await res.json() as { ok: boolean; data?: { url: string }; error?: string }
      if (json.ok && json.data) setChefPhotoUrl(json.data.url)
      else setError(json.error ?? 'Photo upload failed')
    } finally {
      setUploadingChefPhoto(false)
    }
  }

  // Load FH items once so we can show the item name next to its PK
  const { data: fhItemsData } = useAdminFetch<{ items: FHItem[] }>('/api/admin/fareharbor-items')
  const fhItems = fhItemsData?.items ?? []

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

      <div className="pt-4 border-t border-zinc-100">
        <p className="text-sm font-semibold text-zinc-700 mb-1">Food host (optional)</p>
        <p className="text-xs text-zinc-400 mb-3">
          For a "private food cruise" listing with one boat and a food menu — shown as
          "The Food" next to "The Boat" on the listing page. Leave the name empty to
          keep the regular boat-only layout.
        </p>
        <Field label="Name">
          <input
            className={inputCls}
            value={form.chef_name}
            onChange={e => setForm(f => ({ ...f, chef_name: e.target.value }))}
            placeholder="e.g. Ash"
          />
        </Field>
        <Field label="Bio">
          <textarea
            className={`${inputCls} min-h-24`}
            value={form.chef_bio}
            onChange={e => setForm(f => ({ ...f, chef_bio: e.target.value }))}
            placeholder="Who they are, and why guests should book this cruise for the food."
          />
        </Field>
        <Field label="Photo">
          <div className="flex items-center gap-3">
            {chefPhotoUrl && (
              <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-zinc-100 flex-shrink-0">
                <Image src={chefPhotoUrl} alt={form.chef_name || 'Food host'} fill className="object-cover" sizes="64px" />
              </div>
            )}
            <input
              ref={chefPhotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) uploadChefPhoto(file)
              }}
            />
            <button
              type="button"
              onClick={() => chefPhotoInputRef.current?.click()}
              disabled={uploadingChefPhoto}
              className="px-3 py-1.5 rounded-md border border-zinc-200 text-xs font-medium hover:border-zinc-400 disabled:opacity-50"
            >
              {uploadingChefPhoto ? 'Uploading…' : chefPhotoUrl ? 'Replace photo' : 'Upload photo'}
            </button>
          </div>
        </Field>
      </div>

      <div className="pt-4 border-t border-zinc-100">
        <p className="text-sm font-semibold text-zinc-700 mb-1">Theme colors (optional)</p>
        <p className="text-xs text-zinc-400 mb-3">
          Overrides the site's default indigo/crimson just on this listing's page —
          headings, buttons, selected states. Leave both empty for the default theme.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primary (headings, buttons)">
            <div className="flex items-center gap-2">
              {form.theme_primary_color && (
                <span
                  className="w-8 h-8 rounded-md border border-zinc-200 flex-shrink-0"
                  style={{ backgroundColor: form.theme_primary_color }}
                />
              )}
              <input
                className={inputCls}
                value={form.theme_primary_color}
                onChange={e => setForm(f => ({ ...f, theme_primary_color: e.target.value }))}
                placeholder="#009639"
              />
            </div>
          </Field>
          <Field label="Accent (section headings)">
            <div className="flex items-center gap-2">
              {form.theme_accent_color && (
                <span
                  className="w-8 h-8 rounded-md border border-zinc-200 flex-shrink-0"
                  style={{ backgroundColor: form.theme_accent_color }}
                />
              )}
              <input
                className={inputCls}
                value={form.theme_accent_color}
                onChange={e => setForm(f => ({ ...f, theme_accent_color: e.target.value }))}
                placeholder="#E70001"
              />
            </div>
          </Field>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
