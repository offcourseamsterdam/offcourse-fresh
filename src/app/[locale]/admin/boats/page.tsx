'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronDown, ChevronUp } from 'lucide-react'
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

export default function BoatsAdminPage() {
  const supabase = createClient()
  const [boats, setBoats] = useState<Boat[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('boats')
      .select('*')
      .order('display_order')
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

  if (loading) return <div className="p-8 text-sm text-zinc-400">Loading boats…</div>

  if (boats.length === 0) return (
    <div className="p-8 text-sm text-zinc-400">
      No boats found. Make sure you&apos;re logged in as admin — the boats table requires authentication to read.
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
              <div className="border-t border-zinc-100 px-6 py-5 space-y-5">

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
                    {[
                      { field: 'photo_url',          label: 'Main / Open' },
                      { field: 'photo_covered_url',  label: 'Covered' },
                      { field: 'photo_interior_url', label: 'Interior' },
                    ].map(({ field, label }) => {
                      const url = boat[field as keyof Boat] as string | null
                      return (
                        <div key={field} className="flex items-center gap-3">
                          <div className="relative w-16 h-12 rounded-md overflow-hidden bg-zinc-100 flex-shrink-0">
                            {url && (
                              <SafeImage
                                src={url}
                                alt={label}
                                fill
                                sizes="64px"
                                className="object-cover"
                              />
                            )}
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-zinc-400 block mb-1">{label}</label>
                            <input
                              className="w-full text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                              defaultValue={url ?? ''}
                              placeholder="https://…"
                              onBlur={e => updateBoat(boat.id, field, e.target.value || null)}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Description</p>
                  <div className="space-y-3">
                    {[
                      { field: 'description',    label: 'EN' },
                      { field: 'description_nl', label: 'NL' },
                      { field: 'description_de', label: 'DE' },
                      { field: 'description_fr', label: 'FR' },
                      { field: 'description_es', label: 'ES' },
                      { field: 'description_pt', label: 'PT' },
                      { field: 'description_zh', label: 'ZH' },
                    ].map(({ field, label }) => (
                      <div key={field}>
                        <label className="text-xs text-zinc-400 block mb-1">{label}</label>
                        <textarea
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
                      const pks = e.target.value
                        .split(',')
                        .map(s => parseInt(s.trim(), 10))
                        .filter(n => !isNaN(n))
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
