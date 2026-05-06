'use client'

import { useState, useEffect } from 'react'
import { Loader2, Clock, Users } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'

interface FHItem {
  id: string
  name: string
  fareharbor_pk: number
  item_type: string | null
  is_active: boolean
  booking_cutoff_hours: number | null
  max_slot_capacity: number | null
}

export default function FareHarborSettingsPage() {
  const [items, setItems] = useState<FHItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('fareharbor_items')
      .select('id, name, fareharbor_pk, item_type, is_active, booking_cutoff_hours, max_slot_capacity')
      .order('name')
    if (error) console.error('FH items load error:', error)
    setItems((data ?? []) as FHItem[])
    setLoading(false)
  }

  async function updateItem(id: string, field: 'booking_cutoff_hours' | 'max_slot_capacity', rawValue: string) {
    const value = rawValue === '' ? null : Number(rawValue)
    setSaving(id)
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('fareharbor_items')
      .update({ [field]: value })
      .eq('id', id)
    if (error) console.error('FH item update error:', error)
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item))
    setSaving(null)
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">FareHarbor Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Configure booking cutoff windows per FareHarbor item. Slots within the cutoff window
          show a <strong>"Chat to book"</strong> button that opens WhatsApp instead of the
          normal checkout — unless a shared cruise already has at least one booking.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-400">No FareHarbor items found.</p>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <div key={item.id} className="bg-white rounded-xl border border-zinc-200 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-zinc-900">{item.name}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-zinc-400">FH pk: {item.fareharbor_pk}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      item.item_type === 'shared'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-zinc-100 text-zinc-500'
                    }`}>
                      {item.item_type ?? 'unknown'}
                    </span>
                    {!item.is_active && (
                      <span className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full">inactive</span>
                    )}
                  </div>
                </div>
                {saving === item.id && (
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-400 flex-shrink-0" />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Cutoff hours */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 mb-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Booking cutoff (hours)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="e.g. 24 — leave empty to disable"
                    defaultValue={item.booking_cutoff_hours ?? ''}
                    onBlur={e => updateItem(item.id, 'booking_cutoff_hours', e.target.value)}
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  />
                  <p className="text-[10px] text-zinc-400 mt-1">
                    Slots within this many hours of departure show "Chat to book". Empty = no cutoff.
                  </p>
                </div>

                {/* Max slot capacity — shared only */}
                {item.item_type === 'shared' && (
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 mb-1.5">
                      <Users className="w-3.5 h-3.5" />
                      Max slot capacity
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      placeholder="e.g. 12"
                      defaultValue={item.max_slot_capacity ?? ''}
                      onBlur={e => updateItem(item.id, 'max_slot_capacity', e.target.value)}
                      className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                    />
                    <p className="text-[10px] text-zinc-400 mt-1">
                      Full capacity when no one has booked yet. If current capacity is lower,
                      someone has booked and last-minute booking is still allowed.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
