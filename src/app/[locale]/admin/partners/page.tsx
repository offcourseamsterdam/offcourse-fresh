'use client'

import { useState } from 'react'
import {
  Loader2, Plus, Pencil, Check, X, Trash2, Mail, ExternalLink,
  ChevronDown, ChevronUp, Ban,
} from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtEuros } from '@/lib/utils'
import { CampaignModal } from '@/components/admin/tracking/CampaignModal'

// ── Types ──────────────────────────────────────────────────────────────────

interface Partner {
  id: string
  name: string
  email: string | null
  created_at: string | null
  total_commission_cents: number
  campaign_count: number
}

interface PartnerCampaign {
  id: string
  name: string
  slug: string
  is_active: boolean
  percentage_value: number | null
  investment_type: string | null
  listing_id: string | null
  bookings_count: number
  commission_cents: number
}

interface EditState {
  name: string
  email: string
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

  // Inline edit state (name + email per partner id)
  const [editing, setEditing] = useState<Record<string, EditState>>({})
  const [saving, setSaving] = useState<string | null>(null)

  // Expanded rows
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null)
  const [partnerCampaigns, setPartnerCampaigns] = useState<Record<string, PartnerCampaign[]>>({})
  const [loadingCampaigns, setLoadingCampaigns] = useState<string | null>(null)
  const [deletingCampaign, setDeletingCampaign] = useState<string | null>(null)
  const [deactivatingCampaign, setDeactivatingCampaign] = useState<string | null>(null)

  // Campaign modal (create new campaign for a specific partner)
  const [showCampaignModal, setShowCampaignModal] = useState(false)
  const [campaignModalPartnerId, setCampaignModalPartnerId] = useState<string | undefined>()

  // Invite
  const [inviting, setInviting] = useState<string | null>(null)

  // ── Create partner ────────────────────────────────────────────────────

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

  // ── Edit partner (name + email) ───────────────────────────────────────

  function startEdit(p: Partner) {
    setEditing(prev => ({ ...prev, [p.id]: { name: p.name, email: p.email ?? '' } }))
  }

  function cancelEdit(id: string) {
    setEditing(prev => { const next = { ...prev }; delete next[id]; return next })
  }

  async function saveEdit(id: string) {
    const state = editing[id]
    if (!state?.name?.trim()) return
    setSaving(id)
    try {
      const res = await fetch(`/api/admin/partners/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: state.name.trim(), email: state.email.trim() || null }),
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

  // ── Invite ────────────────────────────────────────────────────────────

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

  // ── Delete partner ────────────────────────────────────────────────────

  async function handleDeletePartner(id: string, name: string) {
    if (!confirm(`Delete partner "${name}"? This cannot be undone.`)) return
    try {
      await fetch(`/api/admin/partners/${id}`, { method: 'DELETE' })
      fetchPartners()
    } catch {
      alert('Failed to delete')
    }
  }

  // ── Expand / load campaigns ───────────────────────────────────────────

  async function toggleExpand(id: string) {
    if (expandedPartner === id) { setExpandedPartner(null); return }
    setExpandedPartner(id)
    if (partnerCampaigns[id]) return // already loaded

    setLoadingCampaigns(id)
    try {
      const res = await fetch(`/api/admin/partners/${id}/campaigns`)
      const json = await res.json()
      if (json.ok) setPartnerCampaigns(prev => ({ ...prev, [id]: json.data }))
    } finally {
      setLoadingCampaigns(null)
    }
  }

  function refreshCampaigns(partnerId: string) {
    setLoadingCampaigns(partnerId)
    fetch(`/api/admin/partners/${partnerId}/campaigns`)
      .then(r => r.json())
      .then(json => { if (json.ok) setPartnerCampaigns(prev => ({ ...prev, [partnerId]: json.data })) })
      .catch(() => {})
      .finally(() => setLoadingCampaigns(null))
  }

  // ── Delete campaign ───────────────────────────────────────────────────

  async function handleDeleteCampaign(campaignId: string, partnerId: string) {
    if (!confirm('Delete this campaign? This cannot be undone.')) return
    setDeletingCampaign(campaignId)
    try {
      await fetch(`/api/admin/tracking/campaigns/${campaignId}`, { method: 'DELETE' })
      refreshCampaigns(partnerId)
      fetchPartners()
    } catch {
      alert('Failed to delete campaign')
    } finally {
      setDeletingCampaign(null)
    }
  }

  // ── Deactivate campaign ───────────────────────────────────────────────

  async function handleDeactivateCampaign(campaignId: string, partnerId: string) {
    if (!confirm('Deactivate this campaign?')) return
    setDeactivatingCampaign(campaignId)
    try {
      await fetch(`/api/admin/tracking/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      })
      refreshCampaigns(partnerId)
    } catch {
      alert('Failed to deactivate campaign')
    } finally {
      setDeactivatingCampaign(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">Partners</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Commission rates are set per campaign.
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

      {/* Partner list */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-zinc-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading partners…
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : partners.length === 0 ? (
        <div className="text-center py-16 text-zinc-400 text-sm">
          No partners yet — click &quot;New partner&quot; to add one.
        </div>
      ) : (
        <div className="space-y-2">
          {partners.map(p => {
            const isEditing = !!editing[p.id]
            const isSaving = saving === p.id
            const isExpanded = expandedPartner === p.id
            const isCampaignsLoading = loadingCampaigns === p.id
            const campaigns = partnerCampaigns[p.id] ?? []

            return (
              <div key={p.id} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                {/* Partner row */}
                <div className="flex items-center gap-3 px-5 py-4">
                  {/* Name + email */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => !isEditing && toggleExpand(p.id)}
                  >
                    {isEditing ? (
                      <div className="flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editing[p.id].name}
                          onChange={ev => setEditing(prev => ({
                            ...prev,
                            [p.id]: { ...prev[p.id], name: ev.target.value },
                          }))}
                          onKeyDown={ev => ev.key === 'Enter' && saveEdit(p.id)}
                          placeholder="Partner name"
                          className="w-full px-2 py-1 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                          autoFocus
                        />
                        <input
                          type="email"
                          value={editing[p.id].email}
                          onChange={ev => setEditing(prev => ({
                            ...prev,
                            [p.id]: { ...prev[p.id], email: ev.target.value },
                          }))}
                          placeholder="Email address (for notifications)"
                          className="w-full px-2 py-1 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium text-zinc-900">{p.name}</p>
                          {p.email ? (
                            <p className="text-xs text-zinc-400">{p.email}</p>
                          ) : (
                            <p className="text-xs text-zinc-300 italic">No email — click ✏ to add</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  {!isEditing && (
                    <div
                      className="hidden sm:flex items-center gap-6 text-sm cursor-pointer"
                      onClick={() => toggleExpand(p.id)}
                    >
                      <div className="text-right">
                        <p className="text-xs text-zinc-400">Campaigns</p>
                        <p className="font-medium text-zinc-700">
                          {p.campaign_count > 0 ? p.campaign_count : <span className="text-zinc-300">—</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-zinc-400">Commission</p>
                        <p className={`font-semibold ${p.total_commission_cents > 0 ? 'text-[var(--color-primary)]' : 'text-zinc-300'}`}>
                          {p.total_commission_cents > 0 ? fmtEuros(p.total_commission_cents) : '—'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
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
                          className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors" title="Edit name & email">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeletePartner(p.id, p.name)}
                          className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleExpand(p.id)}
                          className="p-1.5 text-zinc-400 hover:bg-zinc-100 rounded-lg transition-colors"
                        >
                          {isCampaignsLoading
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : isExpanded
                              ? <ChevronUp className="w-3.5 h-3.5" />
                              : <ChevronDown className="w-3.5 h-3.5" />
                          }
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded: campaigns */}
                {isExpanded && !isEditing && (
                  <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-4">
                    {isCampaignsLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                      </div>
                    ) : campaigns.length === 0 ? (
                      <p className="text-xs text-zinc-400 py-2 text-center">No campaigns yet.</p>
                    ) : (
                      <table className="w-full text-xs mb-3">
                        <thead>
                          <tr className="text-zinc-400 uppercase tracking-wider border-b border-zinc-200">
                            <th className="text-left pb-2 font-medium">Campaign</th>
                            <th className="text-right pb-2 font-medium hidden sm:table-cell">Comm %</th>
                            <th className="text-right pb-2 font-medium hidden sm:table-cell">Bookings</th>
                            <th className="text-right pb-2 font-medium">Commission</th>
                            <th className="text-right pb-2 font-medium">Status</th>
                            <th className="pb-2 w-16" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {campaigns.map(c => (
                            <tr key={c.id} className="hover:bg-zinc-100/60 transition-colors">
                              <td className="py-2.5">
                                <p className="font-medium text-zinc-700">{c.name}</p>
                                <code className="text-zinc-400 font-mono">/t/{c.slug}</code>
                              </td>
                              <td className="py-2.5 text-right text-zinc-500 hidden sm:table-cell">
                                {c.investment_type === 'percentage' && c.percentage_value
                                  ? `${c.percentage_value}%`
                                  : <span className="text-zinc-300">—</span>
                                }
                              </td>
                              <td className="py-2.5 text-right text-zinc-500 hidden sm:table-cell">
                                {c.bookings_count > 0 ? c.bookings_count : <span className="text-zinc-300">—</span>}
                              </td>
                              <td className="py-2.5 text-right font-semibold text-[var(--color-primary)]">
                                {c.commission_cents > 0 ? fmtEuros(c.commission_cents) : <span className="text-zinc-300 font-normal">—</span>}
                              </td>
                              <td className="py-2.5 text-right">
                                {c.is_active
                                  ? <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">active</span>
                                  : <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full font-medium">inactive</span>
                                }
                              </td>
                              <td className="py-2.5 text-right">
                                <div className="flex items-center justify-end gap-0.5">
                                  {c.is_active && (
                                    <button
                                      onClick={() => handleDeactivateCampaign(c.id, p.id)}
                                      disabled={deactivatingCampaign === c.id}
                                      className="p-1 text-zinc-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                                      title="Deactivate"
                                    >
                                      {deactivatingCampaign === c.id
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <Ban className="w-3 h-3" />
                                      }
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteCampaign(c.id, p.id)}
                                    disabled={deletingCampaign === c.id}
                                    className="p-1 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                    title="Delete campaign"
                                  >
                                    {deletingCampaign === c.id
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : <Trash2 className="w-3 h-3" />
                                    }
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <button
                      onClick={() => { setCampaignModalPartnerId(p.id); setShowCampaignModal(true) }}
                      className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New campaign for {p.name}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Campaign creation modal */}
      <CampaignModal
        open={showCampaignModal}
        onClose={() => { setShowCampaignModal(false); setCampaignModalPartnerId(undefined) }}
        defaultPartnerId={campaignModalPartnerId}
        onSaved={() => {
          setShowCampaignModal(false)
          setCampaignModalPartnerId(undefined)
          fetchPartners()
          if (expandedPartner) refreshCampaigns(expandedPartner)
        }}
      />
    </div>
  )
}
