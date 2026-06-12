'use client'

import { useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, TextAreaField, Field } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'

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
  const { saving, error, setError, run } = useAdminSave()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required')
      return
    }
    run(async () => {
      const body: Record<string, unknown> = {
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        guest_note: note,
      }
      if (isInternalBooking && depositInput) {
        body.deposit_amount_cents = Math.round(parseFloat(depositInput) * 100)
      }
      await adminMutate(`/api/admin/bookings/${bookingId}`, 'PATCH', body)
      onSuccess()
    })
  }

  return (
    <AdminFormModal
      title="Edit booking"
      subtitle="Updates name, email, phone locally. Note is also synced to FareHarbor."
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel="Save changes"
    >
      <TextField label="Full name" type="text" value={name} onChange={e => setName(e.target.value)} />
      <TextField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      <TextField label="Phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      <TextAreaField label="Guest note" value={note} onChange={e => setNote(e.target.value)} rows={2} />
      {isInternalBooking && (
        <Field label="Deposit (€)">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">€</span>
            <input
              type="number"
              min="0"
              step="1"
              value={depositInput}
              onChange={e => setDepositInput(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
            />
          </div>
        </Field>
      )}
    </AdminFormModal>
  )
}
