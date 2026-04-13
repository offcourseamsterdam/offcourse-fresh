'use client'

import { useState, useEffect } from 'react'
import { CruiseTabProps, patchListing, inputCls } from './shared'
import { Field } from './Field'
import { TabSaveButton } from './TabSaveButton'

interface FHItemCache {
  fareharbor_pk: number
  resources: Array<{ fareharbor_pk: number; name: string }>
  customer_types: Array<{ fareharbor_pk: number; name: string; duration_minutes: number }>
}

interface BoatOption {
  id: string
  name: string
  max_capacity: number | null
  fareharbor_customer_type_pks: number[]
}

export function CruiseConfigTab({ listing, onSave }: CruiseTabProps) {
  const [form, setForm] = useState({
    slug: listing.slug ?? '',
    fareharbor_item_pk: listing.fareharbor_item_pk,
    boat_id: listing.boat_id ?? null,
    allowed_resource_pks: listing.allowed_resource_pks ?? [],
    allowed_customer_type_pks: listing.allowed_customer_type_pks ?? [],
    availability_filters: JSON.stringify(listing.availability_filters ?? {}, null, 2),
    is_published: listing.is_published,
    is_featured: listing.is_featured,
    display_order: listing.display_order,
  })
  const [fhItems, setFhItems] = useState<FHItemCache[]>([])
  const [fhItem, setFhItem] = useState<FHItemCache | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [boats, setBoats] = useState<BoatOption[]>([])

  useEffect(() => {
    fetch('/api/admin/boats')
      .then(r => r.json())
      .then(json => { if (json.ok) setBoats(json.data) })
  }, [])

  useEffect(() => {
    fetch('/api/admin/fareharbor-test?action=supabase-items')
      .then(r => r.json())
      .then(json => {
        if (json.ok) {
          const items = json.data as FHItemCache[]
          setFhItems(items)
          const item = items.find(i => i.fareharbor_pk === listing.fareharbor_item_pk)
          if (item) setFhItem(item)
        }
      })
  }, [listing.fareharbor_item_pk])

  function togglePk(list: number[], pk: number) {
    return list.includes(pk) ? list.filter(p => p !== pk) : [...list, pk]
  }

  function selectBoat(boatId: string | null) {
    const boat = boats.find(b => b.id === boatId) ?? null
    const isPrivate = listing.category === 'private'
    setForm(f => ({
      ...f,
      boat_id: boatId,
      // Private listings: auto-fill customer type PKs from the selected boat.
      // Shared listings: boat_id is reference only — don't touch customer type filter.
      ...(isPrivate && boat
        ? { allowed_customer_type_pks: boat.fareharbor_customer_type_pks }
        : {}),
    }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    let filters: Record<string, unknown> = {}
    try {
      filters = JSON.parse(form.availability_filters)
    } catch {
      setError('Availability filters contains invalid JSON — please fix before saving')
      setSaving(false)
      return
    }
    const json = await patchListing(listing.id, {
      slug: form.slug,
      fareharbor_item_pk: form.fareharbor_item_pk,
      boat_id: form.boat_id,
      allowed_resource_pks: form.allowed_resource_pks,
      allowed_customer_type_pks: form.allowed_customer_type_pks,
      availability_filters: filters,
      is_published: form.is_published,
      is_featured: form.is_featured,
      display_order: Number(form.display_order),
    })
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-6 max-w-xl">
      {/* FareHarbor item selector */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-600">
          FareHarbor item
          <span className="ml-1.5 text-zinc-400 font-normal">— the FH product this listing is connected to</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {fhItems.map(item => (
            <button
              key={item.fareharbor_pk}
              onClick={() => {
                setForm(f => ({ ...f, fareharbor_item_pk: item.fareharbor_pk }))
                setFhItem(item)
              }}
              className={`px-3 py-1.5 rounded-md border text-xs transition-all ${
                form.fareharbor_item_pk === item.fareharbor_pk
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-200 bg-white hover:border-zinc-400'
              }`}
            >
              FH {item.fareharbor_pk}
            </button>
          ))}
        </div>
        {form.fareharbor_item_pk && (
          <p className="text-xs text-zinc-400">
            Currently connected to FH item <span className="font-mono font-medium text-zinc-600">{form.fareharbor_item_pk}</span>
          </p>
        )}
      </div>

      <Field label="Slug">
        <input
          className={inputCls}
          value={form.slug}
          onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
        />
      </Field>

      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-600">
          Boat
          {listing.category === 'private' && (
            <span className="ml-1.5 text-zinc-400 font-normal">— also sets allowed durations</span>
          )}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => selectBoat(null)}
            className={`px-3 py-1.5 rounded-md border text-xs transition-all ${
              !form.boat_id
                ? 'border-zinc-900 bg-zinc-900 text-white'
                : 'border-zinc-200 bg-white hover:border-zinc-400'
            }`}
          >
            Not assigned
          </button>
          {boats.map(boat => (
            <button
              key={boat.id}
              onClick={() => selectBoat(boat.id)}
              className={`px-3 py-1.5 rounded-md border text-xs transition-all ${
                form.boat_id === boat.id
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-200 bg-white hover:border-zinc-400'
              }`}
            >
              {boat.name}
              {boat.max_capacity && (
                <span className="ml-1.5 opacity-60">· max {boat.max_capacity}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {fhItem && fhItem.customer_types.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-600">
            Allowed durations (empty = all)
          </label>
          <div className="flex flex-wrap gap-2">
            {fhItem.customer_types.map(ct => (
              <button
                key={ct.fareharbor_pk}
                onClick={() =>
                  setForm(f => ({
                    ...f,
                    allowed_customer_type_pks: togglePk(
                      f.allowed_customer_type_pks,
                      ct.fareharbor_pk
                    ),
                  }))
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-all ${
                  form.allowed_customer_type_pks.includes(ct.fareharbor_pk)
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white hover:border-zinc-400'
                }`}
              >
                {ct.name} <span className="opacity-60">· {ct.duration_minutes}min</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Field label="Availability filters (JSON)">
        <textarea
          className={`${inputCls} font-mono text-xs min-h-[100px]`}
          value={form.availability_filters}
          onChange={e => setForm(f => ({ ...f, availability_filters: e.target.value }))}
        />
      </Field>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_published}
            onChange={e => setForm(f => ({ ...f, is_published: e.target.checked }))}
          />
          Published
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_featured}
            onChange={e => setForm(f => ({ ...f, is_featured: e.target.checked }))}
          />
          Featured
        </label>
      </div>

      <Field label="Display order">
        <input
          className={inputCls}
          type="number"
          value={form.display_order}
          onChange={e => setForm(f => ({ ...f, display_order: Number(e.target.value) }))}
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
