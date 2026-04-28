'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { Loader2, Plus, RefreshCw, Copy, Check, RotateCcw } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PromoCode {
  id: string
  code: string
  label: string
  discount_type: 'percentage' | 'fixed_amount' | 'full'
  discount_value: number | null
  fixed_discount_cents: number | null
  max_uses: number | null
  uses_count: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  notes: string | null
  created_at: string
}

interface FormState {
  label: string
  code: string
  discount_type: 'percentage' | 'fixed_amount' | 'full'
  discount_value: string
  fixed_discount_euros: string
  max_uses: string
  valid_from: string
  valid_until: string
  notes: string
}

function blankForm(): FormState {
  return {
    label: '',
    code: '',
    discount_type: 'percentage',
    discount_value: '',
    fixed_discount_euros: '',
    max_uses: '100',
    valid_from: '',
    valid_until: '',
    notes: '',
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDiscount(code: PromoCode): string {
  if (code.discount_type === 'full') return '100% off (free)'
  if (code.discount_type === 'percentage') return `${code.discount_value}% off`
  if (code.discount_type === 'fixed_amount' && code.fixed_discount_cents != null)
    return `€${(code.fixed_discount_cents / 100).toFixed(2)} off`
  return '—'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PromoCodesPage() {
  const { data: codesData, isLoading: loading, error, refresh: fetchCodes, mutate: mutateCodes } =
    useAdminFetch<{ codes: PromoCode[] }>('/api/admin/promo-codes')
  const codes = codesData?.codes ?? []

  const [showForm, setShowForm] = useState(false)
  const [editingCode, setEditingCode] = useState<PromoCode | null>(null)
  const [form, setForm] = useState<FormState>(blankForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [copiedId, setCopiedId] = useState<string | null>(null)

  // ── Form ──────────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingCode(null)
    setForm(blankForm())
    setSaveError(null)
    setShowForm(true)
  }

  function openEdit(c: PromoCode) {
    setEditingCode(c)
    setForm({
      label: c.label,
      code: c.code,
      discount_type: c.discount_type,
      discount_value: c.discount_value?.toString() ?? '',
      fixed_discount_euros: c.fixed_discount_cents != null ? (c.fixed_discount_cents / 100).toFixed(2) : '',
      max_uses: c.max_uses?.toString() ?? '',
      valid_from: c.valid_from ? c.valid_from.slice(0, 10) : '',
      valid_until: c.valid_until ? c.valid_until.slice(0, 10) : '',
      notes: c.notes ?? '',
    })
    setSaveError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingCode(null)
    setSaveError(null)
  }

  async function handleSave() {
    if (!form.label.trim()) { setSaveError('Label is required'); return }
    if (form.discount_type === 'percentage' && !form.discount_value) {
      setSaveError('Discount value is required for percentage codes')
      return
    }
    if (form.discount_type === 'fixed_amount' && !form.fixed_discount_euros) {
      setSaveError('Discount amount is required for fixed codes')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        label: form.label.trim(),
        code: form.code.trim() || undefined,
        discount_type: form.discount_type,
        discount_value: form.discount_type === 'percentage' ? Number(form.discount_value) : null,
        fixed_discount_cents: form.discount_type === 'fixed_amount'
          ? Math.round(Number(form.fixed_discount_euros) * 100)
          : null,
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        notes: form.notes.trim() || null,
      }

      const isEdit = !!editingCode
      const url = isEdit ? `/api/admin/promo-codes/${editingCode!.id}` : '/api/admin/promo-codes'
      const method = isEdit ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (json.ok) { await fetchCodes(); closeForm() }
      else setSaveError(json.error ?? 'Failed to save promo code')
    } catch {
      setSaveError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(c: PromoCode) {
    mutateCodes(prev => prev ? { codes: prev.codes.map(x => x.id === c.id ? { ...x, is_active: !x.is_active } : x) } : prev, { revalidate: false })
    try {
      const res = await fetch(`/api/admin/promo-codes/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !c.is_active }),
      })
      const json = await res.json()
      if (!json.ok) mutateCodes(prev => prev ? { codes: prev.codes.map(x => x.id === c.id ? { ...x, is_active: c.is_active } : x) } : prev, { revalidate: false })
    } catch {
      mutateCodes(prev => prev ? { codes: prev.codes.map(x => x.id === c.id ? { ...x, is_active: c.is_active } : x) } : prev, { revalidate: false })
    }
  }

  async function copyCode(c: PromoCode) {
    await navigator.clipboard.writeText(c.code)
    setCopiedId(c.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // ── Active & inactive split ───────────────────────────────────────────────

  const active = codes.filter(c => c.is_active)
  const inactive = codes.filter(c => !c.is_active)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-8 max-w-4xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Promo Codes</h1>
          <p className="text-sm text-zinc-500 mt-1">Discount codes for partners and promotions. Active codes auto-rotate when they hit their usage limit.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchCodes} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" />
            New Code
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && codes.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading promo codes…
        </div>
      )}

      {/* Empty */}
      {!loading && codes.length === 0 && !error && (
        <div className="text-center py-16 text-zinc-400 text-sm space-y-2">
          <p className="text-3xl">🏷️</p>
          <p>No promo codes yet. Create your first one.</p>
        </div>
      )}

      {/* Active codes */}
      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Active</h2>
          <CodesTable
            codes={active}
            copiedId={copiedId}
            onCopy={copyCode}
            onEdit={openEdit}
            onToggleActive={toggleActive}
          />
        </section>
      )}

      {/* Inactive / history */}
      {inactive.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Inactive / History</h2>
          <CodesTable
            codes={inactive}
            copiedId={copiedId}
            onCopy={copyCode}
            onEdit={openEdit}
            onToggleActive={toggleActive}
          />
        </section>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black/20"
            style={{ animation: 'fadeIn 0.2s ease-out' }}
            onClick={closeForm}
          />
          <div
            className="relative max-w-lg mx-auto mt-8 px-4 pb-8"
            style={{ animation: 'slideDown 0.3s ease-out' }}
          >
            <PromoFormModal
              editingCode={editingCode}
              form={form}
              onChange={setForm}
              onSave={handleSave}
              onClose={closeForm}
              saving={saving}
              saveError={saveError}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── CodesTable ────────────────────────────────────────────────────────────────

function CodesTable({
  codes,
  copiedId,
  onCopy,
  onEdit,
  onToggleActive,
}: {
  codes: PromoCode[]
  copiedId: string | null
  onCopy: (c: PromoCode) => void
  onEdit: (c: PromoCode) => void
  onToggleActive: (c: PromoCode) => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Code</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden sm:table-cell">Label</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden md:table-cell">Discount</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Uses</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden lg:table-cell">Expires</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {codes.map(c => (
            <CodeRow
              key={c.id}
              code={c}
              copiedId={copiedId}
              onCopy={onCopy}
              onEdit={onEdit}
              onToggleActive={onToggleActive}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── CodeRow ───────────────────────────────────────────────────────────────────

function CodeRow({
  code: c,
  copiedId,
  onCopy,
  onEdit,
  onToggleActive,
}: {
  code: PromoCode
  copiedId: string | null
  onCopy: (c: PromoCode) => void
  onEdit: (c: PromoCode) => void
  onToggleActive: (c: PromoCode) => void
}) {
  const usagePct = c.max_uses ? Math.min(100, Math.round((c.uses_count / c.max_uses) * 100)) : null

  return (
    <tr className={c.is_active ? '' : 'opacity-50'}>
      {/* Code */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <code className="font-mono text-xs bg-zinc-100 text-zinc-800 px-2 py-0.5 rounded select-all">
            {c.code}
          </code>
          <button
            onClick={() => onCopy(c)}
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
            title="Copy code"
          >
            {copiedId === c.id
              ? <Check className="w-3.5 h-3.5 text-emerald-500" />
              : <Copy className="w-3.5 h-3.5" />
            }
          </button>
        </div>
        {/* Mobile: label + discount inline */}
        <div className="sm:hidden mt-1 text-xs text-zinc-500">
          {c.label} · {fmtDiscount(c)}
        </div>
      </td>

      {/* Label */}
      <td className="px-4 py-3 text-zinc-700 hidden sm:table-cell">{c.label}</td>

      {/* Discount */}
      <td className="px-4 py-3 hidden md:table-cell">
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
          c.discount_type === 'full'
            ? 'bg-violet-100 text-violet-700'
            : c.discount_type === 'fixed_amount'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-amber-100 text-amber-700'
        }`}>
          {fmtDiscount(c)}
        </span>
      </td>

      {/* Uses */}
      <td className="px-4 py-3 hidden lg:table-cell">
        <div className="flex items-center gap-2">
          <span className="text-zinc-700 tabular-nums">
            {c.uses_count}{c.max_uses != null ? ` / ${c.max_uses}` : ''}
          </span>
          {usagePct != null && (
            <div className="w-16 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-red-400' : usagePct >= 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          )}
        </div>
      </td>

      {/* Expires */}
      <td className="px-4 py-3 text-zinc-500 hidden lg:table-cell text-xs">{fmtDate(c.valid_until)}</td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onEdit(c)}
            className="text-xs text-zinc-400 hover:text-zinc-700 px-2 py-1 rounded hover:bg-zinc-100 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onToggleActive(c)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              c.is_active
                ? 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'
                : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'
            }`}
            title={c.is_active ? 'Deactivate' : 'Reactivate'}
          >
            {c.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── PromoFormModal ────────────────────────────────────────────────────────────

function PromoFormModal({
  editingCode,
  form,
  onChange,
  onSave,
  onClose,
  saving,
  saveError,
}: {
  editingCode: PromoCode | null
  form: FormState
  onChange: (f: FormState) => void
  onSave: () => void
  onClose: () => void
  saving: boolean
  saveError: string | null
}) {
  function set(key: keyof FormState, value: string) {
    onChange({ ...form, [key]: value })
  }

  const isEdit = !!editingCode

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
        <h2 className="text-base font-semibold text-zinc-900">
          {isEdit ? 'Edit Promo Code' : 'New Promo Code'}
        </h2>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">&times;</button>
      </div>

      <div className="px-6 py-5 space-y-4">

        {/* Label */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">Label <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={form.label}
            onChange={e => set('label', e.target.value)}
            placeholder="e.g. Partner — Booking.com"
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
          />
        </div>

        {/* Code */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">
            Code
            <span className="ml-1 text-zinc-400 font-normal">(leave blank to auto-generate)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={form.code}
              onChange={e => set('code', e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              className="flex-1 text-sm font-mono border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
            {isEdit && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 border border-zinc-200 rounded-lg px-3 py-2"
                onClick={() => set('code', '')}
                title="Clear to auto-generate a new code"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Rotate
              </button>
            )}
          </div>
        </div>

        {/* Discount type */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">Discount type <span className="text-red-500">*</span></label>
          <div className="flex gap-2">
            {(['percentage', 'fixed_amount', 'full'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => set('discount_type', t)}
                className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${
                  form.discount_type === t
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 text-zinc-600 hover:border-zinc-400'
                }`}
              >
                {t === 'percentage' ? '% Off' : t === 'fixed_amount' ? '€ Off' : 'Free'}
              </button>
            ))}
          </div>
        </div>

        {/* Discount value */}
        {form.discount_type === 'percentage' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">Percentage off <span className="text-red-500">*</span></label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="100"
                value={form.discount_value}
                onChange={e => set('discount_value', e.target.value)}
                placeholder="e.g. 20"
                className="w-32 text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
              />
              <span className="text-sm text-zinc-500">%</span>
            </div>
          </div>
        )}

        {form.discount_type === 'fixed_amount' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">Amount off <span className="text-red-500">*</span></label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">€</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.fixed_discount_euros}
                onChange={e => set('fixed_discount_euros', e.target.value)}
                placeholder="e.g. 25.00"
                className="w-32 text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
              />
            </div>
          </div>
        )}

        {form.discount_type === 'full' && (
          <p className="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            Full discount — booking is free, bypasses Stripe entirely. Use for partner redemptions.
          </p>
        )}

        {/* Max uses */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">
            Max uses
            <span className="ml-1 text-zinc-400 font-normal">(auto-rotates when reached)</span>
          </label>
          <input
            type="number"
            min="1"
            value={form.max_uses}
            onChange={e => set('max_uses', e.target.value)}
            placeholder="e.g. 100"
            className="w-32 text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
          />
        </div>

        {/* Validity dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">Valid from</label>
            <input
              type="date"
              value={form.valid_from}
              onChange={e => set('valid_from', e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-700">Valid until</label>
            <input
              type="date"
              value={form.valid_until}
              onChange={e => set('valid_until', e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-700">Notes</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="e.g. Used for Booking.com partner agreement Q2 2026"
            rows={2}
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 resize-none"
          />
        </div>

        {saveError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {saveError}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-100">
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {isEdit ? 'Save changes' : 'Create code'}
        </Button>
      </div>
    </div>
  )
}
