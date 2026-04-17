'use client'

import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'

interface TrackingLinkModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  campaignId: string
  partnerId?: string
}

export function TrackingLinkModal({ open, onClose, onSaved, campaignId, partnerId }: TrackingLinkModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('https://offcourseamsterdam.com')
  const [commissionType, setCommissionType] = useState<'percentage' | 'fixed_amount'>('percentage')
  const [commissionValue, setCommissionValue] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setDestinationUrl('https://offcourseamsterdam.com')
      setCommissionType('percentage')
      setCommissionValue('')
      setError(null)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!destinationUrl.trim()) { setError('Destination URL is required'); return }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/admin/tracking/campaigns/${campaignId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          destination_url: destinationUrl.trim(),
          partner_id: partnerId || null,
          commission_type: commissionType,
          commission_percentage: commissionType === 'percentage' && commissionValue ? Number(commissionValue) : null,
          fixed_commission_amount: commissionType === 'fixed_amount' && commissionValue ? Math.round(Number(commissionValue) * 100) : null,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to create tracking link')
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
          <h2 className="text-sm font-semibold text-zinc-900">New Tracking Link</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Link name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Instagram bio link"
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Destination URL *</label>
            <input
              type="url"
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://offcourseamsterdam.com/en/cruises/sunset"
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
            <p className="text-[10px] text-zinc-400 mt-1">Where visitors land after clicking the tracking link</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Commission per booking</label>
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
                  €
                </button>
              </div>
              <input
                type="number"
                value={commissionValue}
                onChange={(e) => setCommissionValue(e.target.value)}
                placeholder={commissionType === 'percentage' ? 'e.g. 10' : 'e.g. 15.00'}
                step={commissionType === 'percentage' ? '1' : '0.01'}
                className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
              />
            </div>
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
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
