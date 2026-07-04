'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import {
  Boxes, Loader2, RefreshCw, Plus, Minus, Trash2, Pencil, Copy, Check,
  AlertTriangle, ExternalLink, X,
} from 'lucide-react'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'

interface StockItem {
  id: string
  name: string
  category: 'drinks' | 'snacks' | 'supplies' | 'other'
  unit: string
  pack_size: number | null
  pack_unit: string | null
  location: string | null
  current_count: number
  reorder_threshold: number
  reorder_qty: number
  supplier_name: string | null
  supplier_email: string | null
  active: boolean
  last_counted_at: string | null
  last_reordered_at: string | null
}

const CATEGORY_LABEL: Record<string, string> = {
  drinks: 'Drinks', snacks: 'Snacks', supplies: 'Supplies', other: 'Other',
}
const CATEGORY_ORDER = ['drinks', 'snacks', 'supplies', 'other'] as const

function isLow(i: StockItem) {
  return i.reorder_threshold > 0 && i.current_count <= i.reorder_threshold
}

export default function StockPage() {
  const params = useParams()
  const locale = (params?.locale as string) ?? 'en'
  const { data, isLoading, error, refresh } = useAdminFetch<{ items: StockItem[]; qrUrl: string }>(
    '/api/admin/stock',
    { refreshInterval: 20_000 },
  )
  const items = data?.items ?? []
  const qrUrl = data?.qrUrl ?? ''
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [copied, setCopied] = useState(false)

  const low = items.filter(isLow)

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    try {
      await adminMutate('/api/admin/stock', 'PATCH', { id, ...body })
      refresh()
    } catch { /* surfaced on next poll */ } finally { setBusyId(null) }
  }
  async function remove(id: string) {
    setBusyId(id)
    try {
      await adminMutate(`/api/admin/stock?id=${id}`, 'DELETE')
      refresh()
    } catch { /* */ } finally { setBusyId(null) }
  }

  function copyLink() {
    navigator.clipboard?.writeText(qrUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 inline-flex items-center gap-2">
            <Boxes className="w-6 h-6 text-violet-500" /> Stock
          </h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            Set the reorder rule per item (“2 left → reorder 5”). Staff scan the QR in the storage
            room and tap −/+. When something runs low, the Ghost drafts a supplier reorder email on the{' '}
            <Link href={`/${locale}/admin/ghost`} className="text-violet-600 hover:underline inline-flex items-center gap-0.5">
              Ghost dashboard <ExternalLink className="w-3 h-3" />
            </Link>.
          </p>
        </div>
        <button onClick={() => refresh()} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md text-zinc-500 hover:bg-zinc-100">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && <AdminErrorBanner error={error} />}

      <div className="mt-5 grid sm:grid-cols-[auto_1fr] gap-4">
        {/* QR panel */}
        <div className="bg-white rounded-xl border border-zinc-200 p-4 flex flex-col items-center text-center">
          {qrUrl ? (
            <div className="bg-white p-2 rounded-lg border border-zinc-100">
              <QRCodeSVG value={qrUrl} size={132} />
            </div>
          ) : (
            <div className="w-[148px] h-[148px] flex items-center justify-center text-zinc-300">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          <p className="text-[11px] text-zinc-500 mt-2 max-w-[160px]">Print &amp; stick this in the storage room.</p>
          <button onClick={copyLink} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-violet-600 hover:bg-violet-50">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        {/* Low-stock summary */}
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          {low.length === 0 ? (
            <p className="text-sm text-zinc-500">Everything is above its reorder level. 🎉</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-zinc-800 inline-flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> {low.length} item{low.length > 1 ? 's' : ''} need reordering
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {low.map(i => (
                  <li key={i.id} className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${i.current_count === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {i.name}: {i.current_count} left
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-zinc-400 mt-2">
                The Ghost drafts the supplier email — approve &amp; send it on the Ghost dashboard.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Add item */}
      <div className="mt-5">
        {adding ? (
          <ItemForm
            onCancel={() => setAdding(false)}
            onSave={async (body) => { await adminMutate('/api/admin/stock', 'POST', body); setAdding(false); refresh() }}
          />
        ) : (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800">
            <Plus className="w-4 h-4" /> Add item
          </button>
        )}
      </div>

      {/* Items */}
      {isLoading && !data ? (
        <div className="mt-10 flex items-center gap-2 text-zinc-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <p className="mt-10 text-sm text-zinc-400">No stock items yet. Add your drinks, snacks and supplies above.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {CATEGORY_ORDER.filter(cat => items.some(i => i.category === cat)).map(cat => (
            <div key={cat}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">{CATEGORY_LABEL[cat]}</h2>
              <div className="space-y-2">
                {items.filter(i => i.category === cat).map(item => (
                  editId === item.id ? (
                    <ItemForm
                      key={item.id}
                      item={item}
                      onCancel={() => setEditId(null)}
                      onSave={async (body) => { await adminMutate('/api/admin/stock', 'PATCH', { id: item.id, ...body }); setEditId(null); refresh() }}
                    />
                  ) : (
                    <div key={item.id} className={`bg-white rounded-xl border p-3 flex items-center gap-3 ${isLow(item) ? 'border-amber-300' : 'border-zinc-200'} ${item.active ? '' : 'opacity-50'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-800">{item.name}</span>
                          {isLow(item) && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${item.current_count === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                              {item.current_count === 0 ? 'Out' : 'Low'}
                            </span>
                          )}
                          {item.last_reordered_at && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">reordered</span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          {item.unit}
                          {item.pack_size && item.pack_unit ? ` · ${item.pack_size} ${item.pack_unit} each` : ''}
                          {' · '}reorder at ≤{item.reorder_threshold} → order {item.reorder_qty}
                          {item.supplier_name ? ` · ${item.supplier_name}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => patch(item.id, { current_count: Math.max(0, item.current_count - 1) })} disabled={busyId === item.id} aria-label="Decrease" className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-700 flex items-center justify-center disabled:opacity-50">
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="w-8 text-center text-base font-semibold text-zinc-900">{item.current_count}</span>
                        <button onClick={() => patch(item.id, { current_count: item.current_count + 1 })} disabled={busyId === item.id} aria-label="Increase" className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center disabled:opacity-50">
                          <Plus className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditId(item.id)} aria-label="Edit" className="w-8 h-8 rounded-md text-zinc-400 hover:bg-zinc-100 flex items-center justify-center">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => remove(item.id)} disabled={busyId === item.id} aria-label="Delete" className="w-8 h-8 rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center disabled:opacity-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ItemForm({ item, onSave, onCancel }: {
  item?: StockItem
  onSave: (body: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState(item?.category ?? 'drinks')
  const [unit, setUnit] = useState(item?.unit ?? 'tray')
  const [packSize, setPackSize] = useState(item?.pack_size ? String(item.pack_size) : '')
  const [packUnit, setPackUnit] = useState(item?.pack_unit ?? '')
  const [location, setLocation] = useState(item?.location ?? '')
  const [threshold, setThreshold] = useState(String(item?.reorder_threshold ?? 2))
  const [qty, setQty] = useState(String(item?.reorder_qty ?? 5))
  const [supplierName, setSupplierName] = useState(item?.supplier_name ?? '')
  const [supplierEmail, setSupplierEmail] = useState(item?.supplier_email ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr(null)
    try {
      await onSave({
        name: name.trim(), category, unit: unit.trim() || 'tray', location: location.trim() || null,
        pack_size: parseInt(packSize, 10) > 0 ? parseInt(packSize, 10) : null,
        pack_unit: packUnit.trim() || null,
        reorder_threshold: parseInt(threshold, 10) || 0, reorder_qty: parseInt(qty, 10) || 0,
        supplier_name: supplierName.trim() || null, supplier_email: supplierEmail.trim() || null,
      })
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to save') } finally { setSaving(false) }
  }

  const field = 'border border-zinc-200 rounded-lg px-2.5 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-violet-400'

  return (
    <div className="bg-white rounded-xl border border-violet-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-zinc-800">{item ? 'Edit item' : 'New item'}</p>
        <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-600"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Wine — Red)" className={`${field} sm:col-span-2`} />
        <select value={category} onChange={e => setCategory(e.target.value as StockItem['category'])} className={field}>
          {CATEGORY_ORDER.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit (tray / box / case)" className={field} />
        <div className="sm:col-span-2 flex items-center gap-2 text-xs text-zinc-500">
          1 {unit || 'unit'} =
          <input value={packSize} onChange={e => setPackSize(e.target.value)} type="number" inputMode="numeric" placeholder="12" className={`${field} w-20`} />
          <input value={packUnit} onChange={e => setPackUnit(e.target.value)} placeholder="bottles / cans (optional)" className={`${field} flex-1`} />
        </div>
        <label className="text-xs text-zinc-500 flex items-center gap-2">Reorder at ≤
          <input value={threshold} onChange={e => setThreshold(e.target.value)} type="number" inputMode="numeric" className={`${field} w-20`} />
        </label>
        <label className="text-xs text-zinc-500 flex items-center gap-2">Order qty
          <input value={qty} onChange={e => setQty(e.target.value)} type="number" inputMode="numeric" className={`${field} w-20`} />
        </label>
        <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location (e.g. Storage box A)" className={field} />
        <input value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="Supplier name" className={field} />
        <input value={supplierEmail} onChange={e => setSupplierEmail(e.target.value)} placeholder="Supplier email" className={`${field} sm:col-span-2`} />
      </div>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      <div className="flex items-center gap-2 mt-3">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
        </button>
        <button onClick={onCancel} className="text-sm text-zinc-500 px-3 py-1.5 hover:text-zinc-700">Cancel</button>
      </div>
    </div>
  )
}
