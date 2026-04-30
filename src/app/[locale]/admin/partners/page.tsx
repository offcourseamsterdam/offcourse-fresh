'use client'

import { useState } from 'react'
import { Loader2, Plus, Pencil, Check, X, Trash2, Mail, ExternalLink } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtEuros } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

interface Partner {
  id: string
  name: string
  created_at: string | null
  total_commission_cents: number
  campaign_count: number
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PartnersPage() {
  const { data: partnersData, isLoading: loading, error, refresh: fetchPartners } =
    useAdminFetch<{ partners: Partner[] }>('/api/admin/partners')
  const partners = partnersData?.partners ?? []

  // New partner form
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // Inline edit state
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  // ── Create ─────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const json = await res.json()
      if (json.ok) {
        setNewName('')
        setShowNew(false)
        fetchPartners()
      } else {
        alert(json.error ?? 'Failed to create partner')
      }
    } finally {
      setCreating(false)
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────

  function startEdit(p: Partner) {
    setEditing(prev => ({ ...prev, [p.id]: p.name }))
  }

  function cancelEdit(id: string) {
    setEditing(prev => { const next = { ...prev }; delete next[id]; return next })
  }

  async function saveEdit(id: string) {
    const name = editing[id]
    if (!name?.trim()) return
    setSaving(id)
    try {
      const res = await fetch(`/api/admin/partners/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const json = await res.json()
      if (json.ok) {
        cancelEdit(id)
        fetchPartners()
      } else {
        alert(json.error ?? 'Failed to save')
      }
    } finally {
      setSaving(null)
    }
  }

  // ── Invite ─────────────────────────────────────────────────────────────

  const [inviting, setInviting] = useState<string | null>(null)

  async function handleInvite(id: string, name: string) {
    if (!confirm(`Send a portal invite email to "${name}"?`)) return
    setInviting(id)
    try {
      const res = await fetch(`/api/admin/partners/${id}/invite`, { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        alert(json.data?.message ?? 'Invite sent!')
      } else {
        alert(json.error ?? 'Failed to send invite')
      }
    } catch {
      alert('Failed to send invite')
    } finally {
      setInviting(null)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete partner "${name}"? This cannot be undone.`)) return
    try {
      await fetch(`/api/admin/partners/${id}`, { method: 'DELETE' })
      fetchPartners()
    } catch {
      alert('Failed to delete')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">Partners</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Commission rates are set per campaign in <strong>Campaigns</strong>.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          New partner
        </button>
      </div>

      {/* New partner form */}
      {showNew && (
        <div className="mb-6 p-4 bg-white border border-zinc-200 rounded-xl flex items-center gap-3">
          <input
            type="text"
            placeholder="Partner name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            className="flex-1 px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            autoFocus
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
          </button>
          <button
            onClick={() => { setShowNew(false); setNewName('') }}
            className="p-2 text-zinc-400 hover:text-zinc-600 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-zinc-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading partners…
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : partners.length === 0 ? (
        <div className="text-center py-16 text-zinc-400 text-sm">
          No partners yet — click "New partner" to add one.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="text-left px-5 py-3 font-semibold text-zinc-500 text-xs uppercase tracking-wide">Partner</th>
                <th className="text-right px-5 py-3 font-semibold text-zinc-500 text-xs uppercase tracking-wide">Campaigns</th>
                <th className="text-right px-5 py-3 font-semibold text-zinc-500 text-xs uppercase tracking-wide">Commission earned</th>
                <th className="px-5 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {partners.map(p => {
                const isEditing = !!editing[p.id]
                const isSaving = saving === p.id

                return (
                  <tr key={p.id} className="hover:bg-zinc-50 transition-colors">
                    {/* Name */}
                    <td className="px-5 py-3.5">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editing[p.id]}
                          onChange={ev => setEditing(prev => ({ ...prev, [p.id]: ev.target.value }))}
                          onKeyDown={ev => ev.key === 'Enter' && saveEdit(p.id)}
                          className="w-full px-2 py-1 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                          autoFocus
                        />
                      ) : (
                        <a href={`/en/admin/partners/${p.id}`} className="font-medium text-zinc-900 hover:text-[var(--color-primary)] hover:underline">
                          {p.name}
                        </a>
                      )}
                    </td>

                    {/* Campaign count */}
                    <td className="px-5 py-3.5 text-right text-zinc-500">
                      {p.campaign_count > 0 ? p.campaign_count : <span className="text-zinc-400">—</span>}
                    </td>

                    {/* Earned */}
                    <td className="px-5 py-3.5 text-right">
                      {p.total_commission_cents > 0 ? (
                        <span className="font-semibold text-[var(--color-primary)]">{fmtEuros(p.total_commission_cents)}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(p.id)} disabled={isSaving}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50" title="Save">
                              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button onClick={() => cancelEdit(p.id)}
                              className="p-1.5 text-zinc-400 hover:bg-zinc-100 rounded-lg transition-colors" title="Cancel">
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <a href={`/en/partner?pid=${p.id}`}
                              className="p-1.5 text-zinc-400 hover:text-[var(--color-primary)] hover:bg-zinc-100 rounded-lg transition-colors" title="View portal">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <button onClick={() => handleInvite(p.id, p.name)}
                              disabled={inviting === p.id}
                              className="p-1.5 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50" title="Send portal invite">
                              {inviting === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => startEdit(p)}
                              className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors" title="Edit name">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(p.id, p.name)}
                              className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
