'use client'

import { useState, useEffect } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, SelectField, TextAreaField, Field } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'

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
  settlement_model?: 'affiliate' | 'reseller' | string | null
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
  const { saving, error, setError, run } = useAdminSave()

  // Form state
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState(defaultChannelId ?? '')
  const [partnerId, setPartnerId] = useState('')
  const [listingId, setListingId] = useState('')
  const [commissionType, setCommissionType] = useState<'percentage' | 'fixed_amount'>('percentage')
  const [commissionValue, setCommissionValue] = useState('')
  const [investmentAmount, setInvestmentAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [settlementModel, setSettlementModel] = useState<'affiliate' | 'reseller'>('affiliate')

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
      setSettlementModel(editing?.settlement_model === 'reseller' ? 'reseller' : 'affiliate')
      setError(null)
    }
  }, [open, defaultChannelId, defaultPartnerId, editing, setError])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!channelId) { setError('Please select a channel'); return }

    run(async () => {
      // Auto-derive category from channel slug
      const channel = channels.find(c => c.id === channelId)

      await adminMutate(
        editing ? `/api/admin/tracking/campaigns/${editing.id}` : '/api/admin/tracking/campaigns',
        editing ? 'PUT' : 'POST',
        {
          name: name.trim(),
          channel_id: channelId,
          partner_id: partnerId || null,
          category: channel?.slug ?? 'other',
          listing_id: listingId || null,
          investment_type: commissionType,
          percentage_value: commissionType === 'percentage' && commissionValue ? Number(commissionValue) : null,
          investment_amount: investmentAmount ? Number(investmentAmount) * 100 : null,
          notes: notes.trim() || null,
          settlement_model: settlementModel,
        },
      )
      onSaved()
      onClose()
    })
  }

  return (
    <AdminFormModal
      open={open}
      title={editing ? 'Edit Campaign' : 'New Campaign'}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel={editing ? 'Save Changes' : 'Create Campaign'}
    >
      <TextField
        label="Campaign name *"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Summer Sunset Deal"
        autoFocus
      />

      <SelectField label="Channel *" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
        <option value="">Select channel...</option>
        {channels.map((ch) => (
          <option key={ch.id} value={ch.id}>{ch.name}</option>
        ))}
      </SelectField>

      {/* Partner (optional — show ALL partners, not filtered by channel) */}
      <SelectField label="Partner (optional)" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
        <option value="">No partner (internal campaign)</option>
        {allPartners.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </SelectField>

      {/* Settlement model — only meaningful when there's a partner */}
      {partnerId && (
        <Field label="Who collects the money?">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSettlementModel('affiliate')}
              className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-colors border text-left ${
                settlementModel === 'affiliate'
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
              }`}
            >
              We Collect
              <span className={`block mt-0.5 text-[10px] ${settlementModel === 'affiliate' ? 'text-zinc-300' : 'text-zinc-400'}`}>
                Customer pays us — we pay partner their cut
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSettlementModel('reseller')}
              className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-colors border text-left ${
                settlementModel === 'reseller'
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
              }`}
            >
              They Collect
              <span className={`block mt-0.5 text-[10px] ${settlementModel === 'reseller' ? 'text-zinc-300' : 'text-zinc-400'}`}>
                Partner takes payment — partner remits to us
              </span>
            </button>
          </div>
        </Field>
      )}

      <SelectField
        label="Destination"
        hint="Where the tracking link sends visitors."
        value={listingId}
        onChange={(e) => setListingId(e.target.value)}
      >
        <option value="">Homepage</option>
        {listings.map((l) => (
          <option key={l.id} value={l.id}>{l.title}</option>
        ))}
      </SelectField>

      <Field
        label="Commission (optional)"
        hint={commissionType === 'percentage' ? '% of the base cruise price (excl. extras)' : 'Fixed amount per booking'}
      >
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
      </Field>

      <Field label="Pre-paid investment (optional)">
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
      </Field>

      <TextAreaField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
    </AdminFormModal>
  )
}
