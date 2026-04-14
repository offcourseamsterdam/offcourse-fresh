'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Plus, RefreshCw } from 'lucide-react'
import { ExtrasTable } from '@/components/admin/extras/ExtrasTable'
import { ExtrasFormModal } from '@/components/admin/extras/ExtrasFormModal'
import type { Extra, FormState } from '@/components/admin/extras/types'
import { blankForm, extraToForm, formToPayload } from '@/components/admin/extras/types'

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ExtrasPage() {
  const [extras, setExtras] = useState<Extra[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editingExtra, setEditingExtra] = useState<Extra | null>(null)
  const [form, setForm] = useState<FormState>(blankForm())

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchExtras = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/extras')
      const json = await res.json()
      if (json.ok) {
        setExtras(json.data?.extras ?? [])
      } else {
        setError(json.error ?? 'Failed to load extras')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchExtras() }, [fetchExtras])

  // ── Form open/close ──────────────────────────────────────────────────────────

  function openCreate() {
    setEditingExtra(null)
    setForm(blankForm())
    setSaveError(null)
    setShowForm(true)
  }

  function openEdit(extra: Extra) {
    setEditingExtra(extra)
    setForm(extraToForm(extra))
    setSaveError(null)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingExtra(null)
    setSaveError(null)
  }

  // ── Save (create or update) ──────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = formToPayload(form)
      const isEdit = !!editingExtra
      const url = isEdit ? `/api/admin/extras/${editingExtra!.id}` : '/api/admin/extras'
      const method = isEdit ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (json.ok) {
        await fetchExtras()
        closeForm()
      } else {
        setSaveError(json.error ?? 'Failed to save extra')
      }
    } catch {
      setSaveError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!editingExtra) return
    if (!confirm(`Delete "${editingExtra.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/extras/${editingExtra.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.ok) {
        await fetchExtras()
        closeForm()
      } else {
        setSaveError(json.error ?? 'Failed to delete extra')
      }
    } catch {
      setSaveError('Network error — please try again')
    } finally {
      setDeleting(false)
    }
  }

  // ── Delete directly from table ────────────────────────────────────────────────

  async function handleDeleteDirect(extra: Extra) {
    if (!confirm(`Delete "${extra.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/extras/${extra.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.ok) {
        setExtras(prev => prev.filter(e => e.id !== extra.id))
      } else {
        alert(json.error ?? 'Failed to delete extra')
      }
    } catch {
      alert('Network error — please try again')
    } finally {
      setDeleting(false)
    }
  }

  // ── Active toggle ─────────────────────────────────────────────────────────────

  async function toggleActive(extra: Extra) {
    // Optimistic update
    setExtras(prev => prev.map(e => e.id === extra.id ? { ...e, is_active: !e.is_active } : e))
    try {
      const res = await fetch(`/api/admin/extras/${extra.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !extra.is_active }),
      })
      const json = await res.json()
      if (!json.ok) {
        // Server rejected — revert
        setExtras(prev => prev.map(e => e.id === extra.id ? { ...e, is_active: extra.is_active } : e))
      }
    } catch {
      // Network failure — revert
      setExtras(prev => prev.map(e => e.id === extra.id ? { ...e, is_active: extra.is_active } : e))
    }
  }

  // ── Image upload callback (used by form modal) ───────────────────────────────

  function handleExtrasImageUpdate(extraId: string, imageUrl: string) {
    setExtras(prev => prev.map(e => e.id === extraId ? { ...e, image_url: imageUrl } : e))
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Extras</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage add-ons, upgrades, and required charges</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchExtras} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" />
            New Extra
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
      {loading && extras.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading extras…
        </div>
      )}

      {/* Empty state */}
      {!loading && extras.length === 0 && !error && (
        <div className="text-center py-16 text-zinc-400 text-sm space-y-2">
          <p className="text-3xl">🏷️</p>
          <p>No extras yet. Create your first one.</p>
        </div>
      )}

      {/* Grouped extras list */}
      {extras.length > 0 && (
        <ExtrasTable
          extras={extras}
          onEdit={openEdit}
          onToggleActive={toggleActive}
          onDelete={handleDeleteDirect}
        />
      )}

      {/* Create / Edit form — slides in from top */}
      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20"
            style={{ animation: 'fadeIn 0.2s ease-out' }}
            onClick={closeForm}
          />
          {/* Panel */}
          <div
            className="relative max-w-3xl mx-auto mt-8 px-4 pb-8"
            style={{ animation: 'slideDown 0.3s ease-out' }}
          >
            <ExtrasFormModal
              editingExtra={editingExtra}
              form={form}
              onFormChange={setForm}
              onSave={handleSave}
              onDelete={handleDelete}
              onClose={closeForm}
              saving={saving}
              deleting={deleting}
              saveError={saveError}
              onExtrasUpdate={handleExtrasImageUpdate}
              onEditingExtraUpdate={setEditingExtra}
            />
          </div>
        </div>
      )}

    </div>
  )
}
