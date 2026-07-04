'use client'

import { useState } from 'react'
import { Minus, Plus, Check, Loader2, PackageCheck } from 'lucide-react'

interface StockItem {
  id: string
  name: string
  category: string
  unit: string
  pack_size: number | null
  pack_unit: string | null
  location: string | null
  current_count: number
}

export default function StockCountClient({ token, items }: { token: string; items: StockItem[] }) {
  const [counts, setCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(items.map(i => [i.id, i.current_count])),
  )
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function bump(id: string, delta: number) {
    setCounts(prev => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }))
  }
  function setExact(id: string, value: string) {
    const n = parseInt(value, 10)
    setCounts(prev => ({ ...prev, [id]: Number.isFinite(n) ? Math.max(0, n) : 0 }))
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/stock/count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          counts: items.map(i => ({ id: i.id, count: counts[i.id] ?? 0 })),
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Something went wrong')
        return
      }
      setDone(true)
    } catch {
      setError('Could not save — check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <PackageCheck className="w-8 h-8 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900">Counts saved</h1>
        <p className="text-zinc-500 mt-2 max-w-xs">
          Thanks! Anything below its reorder level will show up for the team to approve a restock.
        </p>
        <button
          onClick={() => setDone(false)}
          className="mt-6 text-sm font-medium text-zinc-600 underline underline-offset-4"
        >
          Count again
        </button>
      </div>
    )
  }

  // Group by location so a box's worth of items sit together.
  const groups = new Map<string, StockItem[]>()
  for (const item of items) {
    const key = item.location || 'Storage'
    const arr = groups.get(key) ?? []
    arr.push(item)
    groups.set(key, arr)
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-24 pb-28">
      <h1 className="text-2xl font-bold text-zinc-900">Stock count</h1>
      <p className="text-sm text-zinc-500 mt-1">
        Tap − / + for each item, or type the number. Then save at the bottom.
      </p>

      {items.length === 0 && (
        <p className="mt-10 text-center text-sm text-zinc-400">
          No stock items yet. Add them in the admin first.
        </p>
      )}

      {[...groups.entries()].map(([location, groupItems]) => (
        <div key={location} className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">{location}</h2>
          <div className="space-y-2">
            {groupItems.map(item => (
              <div key={item.id} className="flex items-center gap-3 bg-white rounded-xl border border-zinc-200 p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 truncate">{item.name}</p>
                  <p className="text-[11px] text-zinc-400">
                    count in {item.unit}s{item.pack_size && item.pack_unit ? ` · ${item.pack_size} ${item.pack_unit} each` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => bump(item.id, -1)}
                    aria-label={`Decrease ${item.name}`}
                    className="w-11 h-11 rounded-full bg-zinc-100 text-zinc-700 flex items-center justify-center active:scale-95 transition"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={counts[item.id] ?? 0}
                    onChange={e => setExact(item.id, e.target.value)}
                    className="w-14 h-11 text-center text-lg font-semibold text-zinc-900 border border-zinc-200 rounded-lg"
                  />
                  <button
                    onClick={() => bump(item.id, 1)}
                    aria-label={`Increase ${item.name}`}
                    className="w-11 h-11 rounded-full bg-zinc-900 text-white flex items-center justify-center active:scale-95 transition"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {items.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 p-4 bg-white/90 backdrop-blur border-t border-zinc-200">
          <button
            onClick={submit}
            disabled={submitting}
            className="max-w-md mx-auto w-full h-12 rounded-xl bg-zinc-900 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.99] transition"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
            {submitting ? 'Saving…' : 'Save counts'}
          </button>
        </div>
      )}
    </div>
  )
}
