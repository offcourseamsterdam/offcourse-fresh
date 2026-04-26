'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CruiseTabProps, patchListing, inputCls } from './shared'
import { Field } from './Field'
import { TabSaveButton } from './TabSaveButton'

interface PartnerOption {
  id: string
  name: string
}

export function CruisePaymentTab({ listing, onSave }: CruiseTabProps) {
  const [paymentMode, setPaymentMode] = useState<'stripe' | 'partner_invoice'>(listing.payment_mode)
  const [partnerId, setPartnerId] = useState<string>(listing.required_partner_id ?? '')
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/partners')
      .then(r => r.json())
      .then(json => {
        if (Array.isArray(json?.data)) {
          setPartners(json.data.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
        }
      })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setError(null)
    if (paymentMode === 'partner_invoice' && !partnerId) {
      setError('Pick a partner before saving partner-invoice mode.')
      setSaving(false)
      return
    }
    const json = await patchListing(listing.id, {
      payment_mode: paymentMode,
      required_partner_id: paymentMode === 'partner_invoice' ? partnerId : null,
    })
    if (json.ok && json.data) onSave(json.data)
    else setError(json.error ?? 'Save failed')
    setSaving(false)
  }

  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-3">
        <p className="text-xs font-medium text-zinc-600">Payment mode</p>
        <label className="flex items-start gap-3 p-4 rounded-xl border border-zinc-200 hover:border-zinc-300 cursor-pointer has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-50 transition-colors">
          <input
            type="radio"
            name="payment_mode"
            value="stripe"
            checked={paymentMode === 'stripe'}
            onChange={() => setPaymentMode('stripe')}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-zinc-900">Stripe (default)</p>
            <p className="text-xs text-zinc-500 mt-0.5">Guest pays online during checkout.</p>
          </div>
        </label>
        <label className="flex items-start gap-3 p-4 rounded-xl border border-zinc-200 hover:border-zinc-300 cursor-pointer has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-50 transition-colors">
          <input
            type="radio"
            name="payment_mode"
            value="partner_invoice"
            checked={paymentMode === 'partner_invoice'}
            onChange={() => setPaymentMode('partner_invoice')}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-zinc-900">Partner invoice</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              No online payment. Guest enters a booking code at checkout. We invoice the partner each quarter.
            </p>
          </div>
        </label>
      </div>

      {paymentMode === 'partner_invoice' && (
        <Field label="Partner">
          <select
            className={inputCls}
            value={partnerId}
            onChange={e => setPartnerId(e.target.value)}
          >
            <option value="">Select a partner…</option>
            {partners.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
            A campaign linking this partner + listing must exist before bookings will succeed.{' '}
            <Link href="/admin/campaigns" className="underline hover:text-zinc-600">Set one up in Campaigns</Link>.
          </p>
        </Field>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <TabSaveButton saving={saving} onClick={save} />
    </div>
  )
}
