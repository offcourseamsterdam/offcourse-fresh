'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { Loader2, Plus, RefreshCw } from 'lucide-react'
import type { AdminPromoCode } from '@/lib/admin/types'
import { CodesTable } from './CodesTable'
import { PromoCodeFormModal, blankForm, type FormState } from './PromoCodeFormModal'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'

export default function AdminPromoCodesPage() {
  const { data: codesData, isLoading: loading, error, refresh: fetchCodes, mutate: mutateCodes } =
    useAdminFetch<{ codes: AdminPromoCode[] }>('/api/admin/promo-codes')
  const codes = codesData?.codes ?? []

  const [showForm, setShowForm] = useState(false)
  const [editingCode, setEditingCode] = useState<AdminPromoCode | null>(null)
  const [form, setForm] = useState<FormState>(blankForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [copiedId, setCopiedId] = useState<string | null>(null)

  function openCreate() {
    setEditingCode(null)
    setForm(blankForm())
    setSaveError(null)
    setShowForm(true)
  }

  function openEdit(c: AdminPromoCode) {
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

  async function toggleActive(c: AdminPromoCode) {
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

  async function copyCode(c: AdminPromoCode) {
    await navigator.clipboard.writeText(c.code)
    setCopiedId(c.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const active = codes.filter(c => c.is_active)
  const inactive = codes.filter(c => !c.is_active)

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

      <AdminErrorBanner error={error} />

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
            <PromoCodeFormModal
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
