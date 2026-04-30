'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { fmtAdminDatetime } from '@/lib/admin/format'

export interface FHItem {
  id: string
  fareharbor_pk: number
  name: string
  item_type: 'private' | 'shared'
  last_synced_at: string | null
  resources: { id: string; fareharbor_pk: number; name: string; capacity: number }[]
  customer_types: { id: string; fareharbor_pk: number; name: string; boat_name: string; duration_minutes: number; max_guests: number }[]
}

export function ItemRow({ item }: { item: FHItem }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{item.name}</span>
          <span className="text-xs text-zinc-400 font-mono">PK {item.fareharbor_pk}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${item.item_type === 'private' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'}`}>
            {item.item_type}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400">
            {item.resources.length} boat{item.resources.length !== 1 ? 's' : ''} · {item.customer_types.length} types
          </span>
          {open ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-100 px-4 py-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Boats (resources)</p>
            {item.resources.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">No boats found yet — boats and types are extracted from availabilities. Re-sync when this item has future availability configured.</p>
            ) : (
              <div className="space-y-1">
                {item.resources.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span>{r.name}</span>
                    <span className="font-mono text-xs text-zinc-400">PK {r.fareharbor_pk}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Customer types (durations)</p>
            {item.customer_types.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">No types found yet — re-sync when availabilities exist.</p>
            ) : (
              <div className="space-y-1">
                {item.customer_types.map(ct => (
                  <div key={ct.id} className="flex items-center justify-between text-sm">
                    <span>{ct.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400">{ct.duration_minutes}min</span>
                      <span className="font-mono text-xs text-zinc-300">PK {ct.fareharbor_pk}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {item.last_synced_at && (
            <p className="col-span-2 text-xs text-zinc-400">Last synced: {fmtAdminDatetime(item.last_synced_at)}</p>
          )}
        </div>
      )}
    </div>
  )
}
