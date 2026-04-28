'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface EditBookingModalProps {
  bookingId: string
  initialName: string | null
  initialEmail: string | null
  initialPhone: string | null
  initialNote: string | null
  isInternalBooking: boolean
  initialDepositCents: number | null
  onClose: () => void
  onSuccess: () => void
}

export function EditBookingModal({
  bookingId,
  initialName,
  initialEmail,
  initialPhone,
  initialNote,
  isInternalBooking,
  initialDepositCents,
  onClose,
  onSuccess,
}: EditBookingModalProps) {
  const [name, setName] = useState(initialName ?? '')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [note, setNote] = useState(initialNote ?? '')
  const [depositInput, setDepositInput] = useState(
    initialDepositCents != null ? String(initialDepositCents / 100) : ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        guest_note: note,
      }
      if (isInternalBooking && depositInput) {
        body.deposit_amount_cents = Math.round(parseFloat(depositInput) * 100)
      }
      const res = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Update failed')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const fields = [
    { label: 'Full name', value: name, set: setName, type: 'text' },
    { label: 'Email', value: email, set: setEmail, type: 'email' },
    { label: 'Phone', value: phone, set: setPhone, type: 'tel' },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Edit booking</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Updates name, email, phone locally. Note is also synced to FareHarbor.
          </p>
        </div>

        <div className="space-y-3">
          {fields.map(({ label, value, set, type }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-zinc-500 mb-1">{label}</label>
              <input
                type={type}
                value={value}
                onChange={e => set(e.target.value)}
                className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1">Guest note</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none"
            />
          </div>
          {isInternalBooking && (
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">Deposit (€)</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-500">€</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={depositInput}
                  onChange={e => setDepositInput(e.target.value)}
                  className="w-24 border border-zinc-200 rounded-md px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {loading ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
