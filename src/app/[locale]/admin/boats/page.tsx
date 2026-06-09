'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronDown, ChevronUp, Upload, Loader2, Sparkles } from 'lucide-react'
import { SafeImage } from '@/components/ui/SafeImage'

type Boat = {
  id: string
  name: string
  built_year: number | null
  max_capacity: number | null
  description: string | null
  description_nl: string | null
  description_de: string | null
  description_fr: string | null
  description_es: string | null
  description_pt: string | null
  description_zh: string | null
  photo_url: string | null
  photo_covered_url: string | null
  photo_interior_url: string | null
  is_active: boolean
  is_electric: boolean
  display_order: number
  fareharbor_customer_type_pks: number[] | null
}

const PHOTO_FIELDS = [
  { field: 'photo_url',          label: 'Open / Main' },
  { field: 'photo_covered_url',  label: 'Covered' },
  { field: 'photo_interior_url', label: 'Interior' },
] as const

const LOCALES = [
  { field: 'description',    label: 'EN', flag: '🇬🇧' },
  { field: 'description_nl', label: 'NL', flag: '🇳🇱' },
  { field: 'description_de', label: 'DE', flag: '🇩🇪' },
  { field: 'description_fr', label: 'FR', flag: '🇫🇷' },
  { field: 'description_es', label: 'ES', flag: '🇪🇸' },
  { field: 'description_pt', label: 'PT', flag: '🇵🇹' },
  { field: 'description_zh', label: 'ZH', flag: '🇨🇳' },
] as const

/* ── Photo upload slot ───────────────────────────────────────────────────── */

function PhotoSlot({
  boatId,
  field,
  label,
  url,
  onUploaded,
}: {
  boatId: string
  field: string
  label: string
  url: string | null
  onUploaded: (field: string, url: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('boatId', boatId)
    fd.append('field', field)
    const res = await fetch('/api/admin/boats/upload', { method: 'POST', body: fd })
    const json = await res.json()
    if (json.ok && json.data?.url) {
      onUploaded(field, json.data.url)
    } else {
      setError(json.error ?? 'Upload failed')
    }
    setUploading(false)
  }

  return (
    <div className="flex items-center gap-4">
      {/* Thumbnail */}
      <div
        className="relative w-24 h-16 rounded-lg overflow-hidden bg-zinc-100 flex-shrink-0 cursor-pointer group border border-zinc-200 hover:border-zinc-400 transition-colors"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
      >
        {url ? (
          <>
            <SafeImage src={url} alt={label} fill sizes="96px" className="object-cover" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Upload className="w-4 h-4 text-white" />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            {uploading
              ? <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
              : <Upload className="w-4 h-4 text-zinc-400" />
            }
          </div>
        )}
        {uploading && url && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>

      {/* Label + status */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-700">{label}</p>
        {url ? (
          <p className="text-xs text-zinc-400 truncate">{url.split('/').pop()}</p>
        ) : (
          <p className="text-xs text-zinc-400">Click or drag to upload</p>
        )}
        {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
      </div>

      {/* Upload button */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50 flex-shrink-0"
      >
        {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
        {uploading ? 'Uploading…' : 'Upload'}
      </button>
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────────────────── */

export default function BoatsAdminPage() {
  const supabase = createClient()
  const [boats, setBoats] = useState<Boat[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [translating, setTranslating] = useState<string | null>(null)
  const [translateError, setTranslateError] = useState<Record<string, string>>({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('boats').select('*').order('display_order')
    if (error) console.error('boats load error:', error)
    const loaded = (data ?? []) as Boat[]
    setBoats(loaded)
    const exp: Record<string, boolean> = {}
    loaded.forEach(b => { exp[b.id] = true })
    setExpanded(exp)
    setLoading(false)
  }

  async function updateBoat(id: string, field: string, value: string | number | boolean | number[] | null) {
    setSaving(id)
    const { error } = await supabase.from('boats').update({ [field]: value }).eq('id', id)
    if (error) console.error('boats update error:', error)
    setBoats(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b))
    setSaving(null)
  }

  async function handleTranslate(boat: Boat) {
    if (!boat.description?.trim()) {
      setTranslateError(prev => ({ ...prev, [boat.id]: 'Write the English description first' }))
      return
    }
    setTranslating(boat.id)
    setTranslateError(prev => ({ ...prev, [boat.id]: '' }))
    try {
      const res = await fetch('/api/admin/boats/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boatName: boat.name, description: boat.description }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Translation failed')
      const t = json.data.translations
      // Save all translations at once
      const updates: Record<string, string> = {
        description_nl: t.nl,
        description_de: t.de,
        description_fr: t.fr,
        description_es: t.es,
        description_pt: t.pt,
        description_zh: t.zh,
      }
      setSaving(boat.id)
      const { error } = await supabase.from('boats').update(updates).eq('id', boat.id)
      if (error) throw new Error(error.message)
      setBoats(prev => prev.map(b => b.id === boat.id ? { ...b, ...updates } : b))
      setSaving(null)
    } catch (e) {
      setTranslateError(prev => ({ ...prev, [boat.id]: e instanceof Error ? e.message : 'Failed' }))
    } finally {
      setTranslating(null)
    }
  }

  if (loading) return <div className="p-8 text-sm text-zinc-400">Loading boats…</div>

  if (boats.length === 0) return (
    <div className="p-8 text-sm text-zinc-400">
      No boats found. Make sure you&apos;re logged in as admin.
    </div>
  )

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">Boats</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage boat details and photos.</p>
      </div>

      <div className="space-y-6">
        {boats.map(boat => (
          <div key={boat.id} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">

            {/* Header */}
            <div
              className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-zinc-50 transition-colors"
              onClick={() => setExpanded(prev => ({ ...prev, [boat.id]: !prev[boat.id] }))}
            >
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-zinc-900 text-lg">{boat.name}</h2>
                {saving === boat.id && <span className="text-xs text-zinc-400">Saving…</span>}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={boat.is_active}
                    onChange={e => updateBoat(boat.id, 'is_active', e.target.checked)}
                    className="w-4 h-4 accent-zinc-900"
                  />
                  <span className="text-xs text-zinc-500">Active</span>
                </label>
                {expanded[boat.id] ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
              </div>
            </div>

            {expanded[boat.id] && (
              <div className="border-t border-zinc-100 px-6 py-5 space-y-6">

                {/* Basic info */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider block mb-1">Built year</label>
                    <input
                      type="number"
                      className="w-full text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      defaultValue={boat.built_year ?? ''}
                      onBlur={e => updateBoat(boat.id, 'built_year', e.target.value ? Number(e.target.value) : null)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider block mb-1">Max capacity</label>
                    <input
                      type="number"
                      className="w-full text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                      defaultValue={boat.max_capacity ?? ''}
                      onBlur={e => updateBoat(boat.id, 'max_capacity', e.target.value ? Number(e.target.value) : null)}
                    />
                  </div>
                </div>

                {/* Photos */}
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Photos</p>
                  <div className="space-y-3">
                    {PHOTO_FIELDS.map(({ field, label }) => (
                      <PhotoSlot
                        key={field}
                        boatId={boat.id}
                        field={field}
                        label={label}
                        url={boat[field as keyof Boat] as string | null}
                        onUploaded={(f, url) => setBoats(prev =>
                          prev.map(b => b.id === boat.id ? { ...b, [f]: url } : b)
                        )}
                      />
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Description</p>
                    <button
                      type="button"
                      onClick={() => handleTranslate(boat)}
                      disabled={translating === boat.id || saving === boat.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-xs font-medium text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
                    >
                      {translating === boat.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Sparkles className="w-3.5 h-3.5" />
                      }
                      {translating === boat.id ? 'Translating…' : 'Translate with AI'}
                    </button>
                  </div>
                  {translateError[boat.id] && (
                    <p className="text-xs text-red-500 mb-2">{translateError[boat.id]}</p>
                  )}
                  <div className="space-y-3">
                    {LOCALES.map(({ field, label, flag }) => (
                      <div key={field}>
                        <label className="text-xs text-zinc-400 flex items-center gap-1 mb-1">
                          <span>{flag}</span> {label}
                        </label>
                        <textarea
                          key={`${boat.id}-${field}-${(boat[field as keyof Boat] as string | null) ?? ''}`}
                          rows={2}
                          className="w-full text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300 resize-none"
                          defaultValue={(boat[field as keyof Boat] as string | null) ?? ''}
                          onBlur={e => updateBoat(boat.id, field, e.target.value || null)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* FareHarbor PKs */}
                <div>
                  <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider block mb-1">FareHarbor customer type PKs</label>
                  <input
                    className="w-full text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300 font-mono"
                    defaultValue={(boat.fareharbor_customer_type_pks ?? []).join(', ')}
                    placeholder="e.g. 123456, 789012"
                    onBlur={e => {
                      const pks = e.target.value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
                      updateBoat(boat.id, 'fareharbor_customer_type_pks', pks.length ? pks : null)
                    }}
                  />
                  <p className="text-xs text-zinc-400 mt-1">Comma-separated FareHarbor PKs for this boat&apos;s customer types.</p>
                </div>

              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
