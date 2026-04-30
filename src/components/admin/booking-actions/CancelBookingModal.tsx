'use client'

import { useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface CancelBookingModalProps {
  bookingId: string
  guestName: string | null
  cruiseTitle: string | null
  bookingDate: string | null
  isWebsiteBooking: boolean
  totalAmountCents: number | null
  onClose: () => void
  onSuccess: () => void
}

type RefundOption = 'full' | 'partial' | 'none'

export function CancelBookingModal({
  bookingId,
  guestName,
  cruiseTitle,
  bookingDate,
  isWebsiteBooking,
  totalAmountCents,
  onClose,
  onSuccess,
}: CancelBookingModalProps) {
  const [refundOption, setRefundOption] = useState<RefundOption>('full')
  const [partialInput, setPartialInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      const partialAmountCents =
        refundOption === 'partial' ? Math.round(parseFloat(partialInput || '0') * 100) : undefined
      const res = await fetch(`/api/admin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refundOption, partialAmountCents }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Cancellation failed')
      // Booking cancelled — if Stripe refund failed, warn before closing
      if (json.refundError) {
        setError(`Booking cancelled ✓ — Stripe refund failed: ${json.refundError}. Process it manually in your Stripe dashboard.`)
        setLoading(false)
        return
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Cancel booking</h2>
            <p className="text-sm text-zinc-500 mt-0.5">This cancels the FareHarbor slot and cannot be undone.</p>
          </div>
        </div>

        <div className="bg-zinc-50 rounded-lg px-4 py-3 space-y-1 text-sm">
          <p className="font-medium text-zinc-900">{guestName ?? '—'}</p>
          <p className="text-zinc-500">{cruiseTitle ?? '—'}</p>
          {bookingDate && <p className="text-zinc-500">{bookingDate}</p>}
        </div>

        {isWebsiteBooking && totalAmountCents != null && totalAmountCents > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Stripe refund</p>
            <div className="space-y-1.5">
              {(['full', 'partial', 'none'] as RefundOption[]).map(opt => (
                <label key={opt} className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="refund"
                    value={opt}
                    checked={refundOption === opt}
                    onChange={() => setRefundOption(opt)}
                    className="accent-zinc-900"
                  />
                  <span className="text-sm text-zinc-700">
                    {opt === 'full'
                      ? `Full refund (€${(totalAmountCents / 100).toFixed(0)})`
                      : opt === 'partial'
                      ? 'Partial refund'
                      : 'No refund'}
                  </span>
                </label>
              ))}
            </div>
            {refundOption === 'partial' && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-zinc-500">€</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={partialInput}
                  onChange={e => setPartialInput(e.target.value)}
                  className="w-24 border border-zinc-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
                <span className="text-xs text-zinc-400">max €{(totalAmountCents / 100).toFixed(0)}</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className={`text-sm rounded-lg px-3 py-2 ${
            error.startsWith('Booking cancelled')
              ? 'text-amber-700 bg-amber-50'
              : 'text-red-600 bg-red-50'
          }`}>{error}</p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            {error?.startsWith('Booking cancelled') ? 'Close' : 'Go back'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={loading || (refundOption === 'partial' && (!partialInput || parseFloat(partialInput) <= 0))}
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {loading ? 'Cancelling…' : 'Confirm cancel'}
          </Button>
        </div>
      </div>
    </div>
  )
}
