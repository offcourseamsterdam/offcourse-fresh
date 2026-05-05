'use client'

import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'

interface Channel {
  id: string
  name: string
  slug: string
}

interface Partner {
  id: string
  name: string
}

interface Listing {
  id: string
  title: string
  slug: string
}

interface EditingCampaign {
  id: string
  name: string
  channel_id?: string | null
  partner_id?: string | null
  category: string
  investment_type?: string | null
  percentage_value?: number | null
  investment_amount?: number | null
  listing_id?: string | null
  notes?: string | null
}

interface CampaignModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  /** Pre-select a channel when opening from within a channel */
  defaultChannelId?: string
  /** Pre-select a partner when opening from the Partners page */
  defaultPartnerId?: string
  editing?: EditingCampaign | null
}

export function CampaignModal({ open, onClose, onSaved, defaultChannelId, defaultPartnerId, editing }: CampaignModalProps) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [allPartners, setAllPartners] = useState<Partner[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState(defaultChannelId ?? '')
  const [partnerId, setPartnerId] = useState('')
  const [listingId, setListingId] = useState('')
  const [commissionType, setCommissionType] = useState<'percentage' | 'fixed_amount'>('percentage')
  const [commissionValue, setCommissionValue] = useState('')
  const [investmentAmount, setInvestmentAmount] = useState('')
  const [notes, setNotes] = useState('')

  // Load channels, partners, and listings on mount
  useEffect(() => {
    if (!open) return
    Promise.all([
      fetch('/api/admin/tracking/channels').then((r) => r.json()),
      fetch('/api/admin/partners').then((r) => r.json()),
      fetch('/api/admin/cruise-listings').then((r) => r.json()),
    ]).then(([chJson, pJson, lJson]) => {
      if (chJson.ok) setChannels(chJson.data)
      if (pJson.ok) setAllPartners(pJson.data?.partners ?? pJson.data ?? [])
      if (lJson.ok) setListings(lJson.data?.listings ?? lJson.data ?? [])
    }).catch(() => {})
  }, [open])

  // Reset/prefill form when opening
  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setChannelId(editing?.channel_id ?? defaultChannelId ?? '')
      setPartnerId(editing?.partner_id ?? defaultPartnerId ?? '')
      setListingId(editing?.listing_id ?? '')
      setCommissionType((editing?.investment_type as 'percentage' | 'fixed_amount') ?? 'percentage')
      setCommissionValue(editing?.percentage_value?.toString() ?? '')
      setInvestmentAmount(editing?.investment_amount ? (editing.investment_amount / 100).toString() : '')
      setNotes(editing?.notes ?? '')
      setError(null)
    }
  }, [open, defaultChannelId, defaultPartnerId, editing])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!channelId) { setError('Please select a channel'); return }

    setSaving(true)
    setError(null)

    try {
      // Auto-derive category from channel slug
      const channel = channels.find(c => c.id === channelId)

      const url = editing
        ? `/api/admin/tracking/campaigns/${editing.id}`
        : '/api/admin/tracking/campaigns'
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          channel_id: channelId,
          partner_id: partnerId || null,
          category: channel?.slug ?? 'other',
          listing_id: listingId || null,
          investment_type: commissionType,
          percentage_value: commissionType === 'percentage' && commissionValue ? Number(commissionValue) : null,
          investment_amount: investmentAmount ? Number(investmentAmount) * 100 : null,
          notes: notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to save campaign')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-xl border border-zinc-200 shadow-xl w-full max-w-md mx-4 animate-modal-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-semibold text-zinc-900">{editing ? 'Edit Campaign' : 'New Campaign'}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Campaign name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer Sunset Deal"
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Channel */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Channel *</label>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            >
              <option value="">Select channel...</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>
          </div>

          {/* Partner (optional — show ALL partners, not filtered by channel) */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Partner (optional)</label>
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            >
              <option value="">No partner (internal campaign)</option>
              {allPartners.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Destination listing */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Destination</label>
            <select
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            >
              <option value="">Homepage</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>{l.title}</option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-400 mt-1">Where the tracking link sends visitors.</p>
          </div>

          {/* Commission (optional) */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Commission (optional)</label>
            <div className="flex gap-2">
              <div className="flex rounded-lg border border-zinc-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCommissionType('percentage')}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${commissionType === 'percentage' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-50'}`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => setCommissionType('fixed_amount')}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${commissionType === 'fixed_amount' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-50'}`}
                >
                  &euro;
                </button>
              </div>
              <input
                type="number"
                value={commissionValue}
                onChange={(e) => setCommissionValue(e.target.value)}
                placeholder={commissionType === 'percentage' ? 'e.g. 15' : 'e.g. 25.00'}
                step={commissionType === 'percentage' ? '1' : '0.01'}
                className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              />
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">
              {commissionType === 'percentage' ? '% of the base cruise price (excl. extras)' : 'Fixed amount per booking'}
            </p>
          </div>

          {/* Pre-paid investment */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Pre-paid investment (optional)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">&euro;</span>
              <input
                type="number"
                value={investmentAmount}
                onChange={(e) => setInvestmentAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                className="w-full pl-7 pr-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : editing ? 'Save Changes' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
