'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { ItemRow, type FHItem } from './ItemRow'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, RefreshCw, Database, Plus, Check, Globe, Home, Pencil, Clock, Copy } from 'lucide-react'

// ── Types ──────────────────────────────────────────────

interface CruiseListing {
  id: string
  fareharbor_item_pk: number
  slug: string
  title: string
  category: string
  is_published: boolean
  is_featured: boolean
  display_order: number
  allowed_resource_pks: number[]
  allowed_customer_type_pks: number[]
  availability_filters: Record<string, unknown>
  booking_cutoff_hours: number | null
  created_at: string
}

interface NewListing {
  fareharbor_item_pk: number
  slug: string
  title: string
  category: string
  allowed_resource_pks: number[]
  allowed_customer_type_pks: number[]
  availability_filters: string
}

// ── Helpers ────────────────────────────────────────────

// ── Page ───────────────────────────────────────────────

export default function AdminCruisesPage() {
  const router = useRouter()
  const params = useParams()
  const locale = (params.locale as string) ?? 'en'

  const { data: itemsData, isLoading: loadingItems, refresh: refreshItems } =
    useAdminFetch<{ data: FHItem[] }>('/api/admin/fareharbor-test?action=supabase-items')
  const fhItems = itemsData?.data ?? null

  const { data: listingsData, isLoading: loadingListings, mutate: mutateListings } =
    useAdminFetch<{ data: CruiseListing[] }>('/api/admin/fareharbor-test?action=listings')
  const listings = listingsData?.data ?? null

  const [syncing, setSyncing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState<NewListing>({
    fareharbor_item_pk: 0,
    slug: '',
    title: '',
    category: 'private',
    allowed_resource_pks: [],
    allowed_customer_type_pks: [],
    availability_filters: '{}',
  })

  async function syncItems() {
    setSyncing(true)
    try {
      const res = await fetch('/api/admin/fareharbor-test?action=sync-items')
      const json = await res.json()
      if (json.ok) refreshItems()
    } finally {
      setSyncing(false)
    }
  }

  async function saveListing() {
    setSaving(true)
    setSaveError(null)
    try {
      let filters: Record<string, unknown> = {}
      try { filters = JSON.parse(form.availability_filters) } catch { /* keep empty */ }

      const res = await fetch('/api/admin/cruise-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fareharbor_item_pk: form.fareharbor_item_pk,
          slug: form.slug,
          title: form.title,
          category: form.category,
          allowed_resource_pks: form.allowed_resource_pks,
          allowed_customer_type_pks: form.allowed_customer_type_pks,
          availability_filters: filters,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        router.push(`/${locale}/admin/cruises/${json.data?.listing?.id}`)
      } else {
        setSaveError(json.error ?? 'Failed to save')
      }
    } finally {
      setSaving(false)
    }
  }

  const selectedFhItem = fhItems?.find(i => i.fareharbor_pk === form.fareharbor_item_pk)

  const [savingCutoff, setSavingCutoff] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState<string | null>(null)

  async function toggleListingField(id: string, field: 'is_published' | 'is_featured', value: boolean) {
    mutateListings(prev => prev ? { data: prev.data.map(l => l.id === id ? { ...l, [field]: value } : l) } : prev, { revalidate: false })
    await fetch(`/api/admin/cruise-listings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
  }

  async function duplicateListing(id: string) {
    setDuplicating(id)
    try {
      const res = await fetch(`/api/admin/cruise-listings/${id}/duplicate`, { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        router.push(`/${locale}/admin/cruises/${json.data.listing.id}`)
      }
    } finally {
      setDuplicating(null)
    }
  }

  async function saveCutoff(id: string, rawValue: string) {
    const value = rawValue === '' ? null : Number(rawValue)
    setSavingCutoff(id)
    mutateListings(prev => prev ? { data: prev.data.map(l => l.id === id ? { ...l, booking_cutoff_hours: value } : l) } : prev, { revalidate: false })
    await fetch(`/api/admin/cruise-listings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_cutoff_hours: value }),
    })
    setSavingCutoff(null)
  }

  function togglePk(list: number[], pk: number): number[] {
    return list.includes(pk) ? list.filter(p => p !== pk) : [...list, pk]
  }

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Cruise Listings</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage bookable cruise products and their FareHarbor configuration.</p>
      </div>

      {/* ── Section A: FareHarbor Items ───────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="w-4 h-4 text-zinc-400" />
                FareHarbor items
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {fhItems === null ? 'Loading…' : fhItems.length === 0 ? 'No items downloaded yet' : `${fhItems.length} item${fhItems.length !== 1 ? 's' : ''} in Supabase`}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={syncItems} disabled={syncing || loadingItems}>
              {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {fhItems?.length ? 'Re-sync' : 'Download from FareHarbor'}
            </Button>
          </div>
        </CardHeader>

        {fhItems && fhItems.length > 0 && (
          <CardContent>
            <div className="space-y-3">
              {fhItems.map(item => (
                <ItemRow key={item.id} item={item} />
              ))}
            </div>
          </CardContent>
        )}

        {fhItems?.length === 0 && !loadingItems && (
          <CardContent>
            <p className="text-sm text-zinc-500">Download the FareHarbor items first to see the available boats and duration options. You'll need these PKs to configure cruise listings.</p>
          </CardContent>
        )}
      </Card>

      {/* ── Section B: Cruise Listings ────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Cruise listings</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {listings === null ? 'Loading…' : `${listings.length} listing${listings.length !== 1 ? 's' : ''}`}
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => setShowForm(s => !s)}
              disabled={!fhItems?.length}
            >
              <Plus className="w-3.5 h-3.5" />
              New listing
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Create form */}
          {showForm && fhItems && (
            <div className="border border-zinc-200 rounded-lg p-4 bg-zinc-50 space-y-4">
              <h3 className="text-sm font-semibold text-zinc-800">New cruise listing</h3>

              {/* FH Item select */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-600">FareHarbor item</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {fhItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => setForm(f => ({ ...f, fareharbor_item_pk: item.fareharbor_pk, allowed_resource_pks: [], allowed_customer_type_pks: [] }))}
                      className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                        form.fareharbor_item_pk === item.fareharbor_pk
                          ? 'border-zinc-900 bg-zinc-900 text-white'
                          : 'border-zinc-200 bg-white hover:border-zinc-400'
                      }`}
                    >
                      <span className="font-medium">{item.name}</span>
                      <span className={`ml-2 text-xs ${form.fareharbor_item_pk === item.fareharbor_pk ? 'text-zinc-300' : 'text-zinc-400'}`}>
                        PK {item.fareharbor_pk}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Slug + Title */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600">Slug</label>
                  <Input
                    placeholder="hidden-gems-private"
                    value={form.slug}
                    onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600">Title</label>
                  <Input
                    placeholder="Hidden Gems Private Tour"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  />
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-600">Category</label>
                <div className="flex gap-2">
                  {['private', 'shared', 'standard'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setForm(f => ({ ...f, category: cat }))}
                      className={`px-3 py-1.5 rounded-md border text-xs capitalize transition-all ${
                        form.category === cat ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white hover:border-zinc-400'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Resource PKs (boats) */}
              {selectedFhItem && selectedFhItem.resources.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600">Allowed boats (leave empty = all)</label>
                  <div className="flex flex-wrap gap-2">
                    {selectedFhItem.resources.map(r => (
                      <button
                        key={r.id}
                        onClick={() => setForm(f => ({ ...f, allowed_resource_pks: togglePk(f.allowed_resource_pks, r.fareharbor_pk) }))}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-all ${
                          form.allowed_resource_pks.includes(r.fareharbor_pk)
                            ? 'border-zinc-900 bg-zinc-900 text-white'
                            : 'border-zinc-200 bg-white hover:border-zinc-400'
                        }`}
                      >
                        {form.allowed_resource_pks.includes(r.fareharbor_pk) && <Check className="w-3 h-3" />}
                        {r.name} <span className="opacity-60">· {r.fareharbor_pk}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Customer type PKs (durations) */}
              {selectedFhItem && selectedFhItem.customer_types.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600">Allowed durations (leave empty = all)</label>
                  <div className="flex flex-wrap gap-2">
                    {selectedFhItem.customer_types.map(ct => (
                      <button
                        key={ct.id}
                        onClick={() => setForm(f => ({ ...f, allowed_customer_type_pks: togglePk(f.allowed_customer_type_pks, ct.fareharbor_pk) }))}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-all ${
                          form.allowed_customer_type_pks.includes(ct.fareharbor_pk)
                            ? 'border-zinc-900 bg-zinc-900 text-white'
                            : 'border-zinc-200 bg-white hover:border-zinc-400'
                        }`}
                      >
                        {form.allowed_customer_type_pks.includes(ct.fareharbor_pk) && <Check className="w-3 h-3" />}
                        {ct.name} <span className="opacity-60">· {ct.duration_minutes}min</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Availability filters JSON */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-600">
                  Availability filters <span className="text-zinc-400 font-normal">(JSON — e.g. {`{"time_after":"17:00"}`})</span>
                </label>
                <Input
                  value={form.availability_filters}
                  onChange={e => setForm(f => ({ ...f, availability_filters: e.target.value }))}
                  className="font-mono text-xs"
                  placeholder="{}"
                />
              </div>

              {saveError && <p className="text-sm text-red-600">{saveError}</p>}

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={saveListing}
                  disabled={saving || !form.slug || !form.title || !form.fareharbor_item_pk}
                >
                  {saving ? <Loader2 className="animate-spin" /> : null}
                  {saving ? 'Saving…' : 'Create listing'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Listings table */}
          {loadingListings ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-4">
              <Loader2 className="animate-spin w-4 h-4" /> Loading listings…
            </div>
          ) : listings && listings.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-center">
                    <span className="flex items-center gap-1.5 justify-center">
                      <Globe className="w-3.5 h-3.5" /> Live
                    </span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span className="flex items-center gap-1.5 justify-center">
                      <Home className="w-3.5 h-3.5" /> Homepage
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Cutoff (h)
                    </span>
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {listings.map(l => (
                  <TableRow
                    key={l.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/${locale}/admin/cruises/${l.id}`)}
                  >
                    <TableCell>
                      <span className="font-medium">{l.title}</span>
                      <span className="block text-xs text-zinc-400 font-mono mt-0.5">FH {l.fareharbor_item_pk}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs capitalize px-2 py-0.5 rounded bg-zinc-100 text-zinc-600">{l.category}</span>
                    </TableCell>
                    {/* Live toggle */}
                    <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => toggleListingField(l.id, 'is_published', !l.is_published)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                          l.is_published ? 'bg-emerald-500' : 'bg-zinc-200'
                        }`}
                        title={l.is_published ? 'Live — click to unpublish' : 'Draft — click to publish'}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            l.is_published ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </TableCell>
                    {/* Homepage toggle */}
                    <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => toggleListingField(l.id, 'is_featured', !l.is_featured)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                          l.is_featured ? 'bg-indigo-500' : 'bg-zinc-200'
                        }`}
                        title={l.is_featured ? 'On homepage — click to remove' : 'Not on homepage — click to feature'}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            l.is_featured ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </TableCell>
                    {/* Booking cutoff */}
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={l.booking_cutoff_hours ?? ''}
                          onBlur={e => saveCutoff(l.id, e.target.value)}
                          placeholder="—"
                          className="w-16 text-sm border border-zinc-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-zinc-300 text-center"
                        />
                        {savingCutoff === l.id && (
                          <Loader2 className="w-3 h-3 animate-spin text-zinc-400 absolute -right-4" />
                        )}
                      </div>
                    </TableCell>
                    {/* Edit + Duplicate buttons */}
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => router.push(`/${locale}/admin/cruises/${l.id}`)}
                          className="p-1.5 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
                          title="Edit listing"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => duplicateListing(l.id)}
                          disabled={duplicating === l.id}
                          className="p-1.5 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors disabled:opacity-40"
                          title="Duplicate listing"
                        >
                          {duplicating === l.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Copy className="w-3.5 h-3.5" />
                          }
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : listings?.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4">No listings yet. Create one using the button above.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
