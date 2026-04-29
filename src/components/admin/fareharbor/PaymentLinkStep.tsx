'use client'

import { useState } from 'react'
import type { Listing, Slot, Rate, Contact } from './types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

interface Props {
  listing: Listing
  slot: Slot
  rate: Rate
  guestCount: number
  contact: Contact
  date: string
  extrasCalculation: ExtrasCalculation | null
  onBack: () => void
  onSuccess: (bookingId: string, paymentUrl: string) => void
}

export function PaymentLinkStep({
  listing, slot, rate, guestCount, contact, date, extrasCalculation, onBack, onSuccess,
}: Props) {
  const defaultAmountCents = extrasCalculation?.grand_total_cents ?? 0
  const [amountInput, setAmountInput] = useState(
    defaultAmountCents > 0 ? (defaultAmountCents / 100).toFixed(2) : ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountCents = Math.round(parseFloat(amountInput || '0') * 100)

  async function handleSubmit() {
    if (amountCents < 100) {
      setError('Minimum bedrag is €1.00')
      return
    }
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/admin/booking-flow/create-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availPk: slot.pk,
          customerTypeRatePk: rate.pk,
          guestCount,
          category: listing.category,
          contact: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
          },
          note: contact.note || undefined,
          listingId: listing.id,
          listingTitle: listing.title,
          date,
          startAt: slot.start_at,
          endAt: slot.end_at,
          extrasSelected: extrasCalculation?.line_items ?? [],
          overrideAmountCents: amountCents,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        onSuccess(json.bookingId, json.paymentUrl)
      } else {
        setError(json.error ?? 'Er ging iets mis')
      }
    } catch {
      setError('Netwerkfout — probeer opnieuw')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-6 space-y-4">
        <h3 className="font-semibold text-zinc-900">Betaallink aanmaken</h3>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-500">Klant:</span>
          <span className="text-sm font-medium text-zinc-900">{contact.name}</span>
          <span className="text-sm text-zinc-400">({contact.email})</span>
        </div>

        {extrasCalculation && extrasCalculation.line_items.length > 0 && (
          <div className="rounded-md bg-zinc-50 px-4 py-3 space-y-1">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Berekende prijs</p>
            {extrasCalculation.line_items.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-zinc-600">{item.name}</span>
                <span className="text-zinc-600">€{(item.amount_cents / 100).toFixed(2)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-semibold border-t border-zinc-200 pt-2 mt-1">
              <span>Totaal</span>
              <span>€{(extrasCalculation.grand_total_cents / 100).toFixed(2)}</span>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-700">
            Bedrag dat naar klant wordt gestuurd (€)
          </label>
          <input
            type="number"
            min="1"
            step="0.01"
            value={amountInput}
            onChange={e => setAmountInput(e.target.value)}
            className="block w-48 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            placeholder="0.00"
          />
          <p className="text-xs text-zinc-400">Pas aan voor korting of custom quote.</p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={loading}
          className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-40"
        >
          Back
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading || amountCents < 100}
          className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm font-semibold hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          {loading ? 'Bezig...' : 'Boeking aanmaken + betaallink sturen'}
        </button>
      </div>
    </div>
  )
}
