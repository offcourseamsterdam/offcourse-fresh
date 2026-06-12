'use client'

import { useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, SelectField, TextAreaField, Field } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import type { Database } from '@/lib/supabase/types'

export type StaffRow = Database['public']['Tables']['staff']['Row']
export type CaptainProfile = { id: string; display_name: string | null; email: string }

interface StaffFormModalProps {
  editing: StaffRow | null
  captainProfiles: CaptainProfile[]
  onClose: () => void
  onSaved: () => void
}

export function StaffFormModal({ editing, captainProfiles, onClose, onSaved }: StaffFormModalProps) {
  const { saving, error, setError, run } = useAdminSave()

  const [name, setName] = useState(editing?.name ?? '')
  const [phone, setPhone] = useState(editing?.phone ?? '')
  const [email, setEmail] = useState(editing?.email ?? '')
  const [role, setRole] = useState<'skipper' | 'host'>(
    (editing?.role as 'skipper' | 'host') ?? 'skipper',
  )
  // Rate edits in euros; stored as cents.
  const [rateEuros, setRateEuros] = useState(
    editing ? (editing.hourly_rate_cents / 100).toFixed(2) : '',
  )
  const [slackMemberId, setSlackMemberId] = useState(editing?.slack_member_id ?? '')
  const [isActive, setIsActive] = useState(editing?.is_active ?? true)
  const [maxShifts, setMaxShifts] = useState(editing?.max_shifts_per_week?.toString() ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [userId, setUserId] = useState(editing?.user_id ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    const rate = rateEuros === '' ? 0 : Number(rateEuros)
    if (Number.isNaN(rate) || rate < 0) { setError('Hourly rate must be a positive number'); return }

    run(async () => {
      await adminMutate(
        editing ? `/api/admin/scheduling/staff/${editing.id}` : '/api/admin/scheduling/staff',
        editing ? 'PUT' : 'POST',
        {
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          role,
          hourly_rate_cents: Math.round(rate * 100),
          slack_member_id: slackMemberId.trim() || null,
          is_active: isActive,
          max_shifts_per_week: maxShifts ? Number(maxShifts) : null,
          notes: notes.trim() || null,
          user_id: userId || null,
        },
      )
      onSaved()
    })
  }

  return (
    <AdminFormModal
      title={editing ? `Edit ${editing.name}` : 'Add staff'}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel={editing ? 'Save changes' : 'Add staff'}
    >
      <TextField
        label="Name *"
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="e.g. Joris"
        autoFocus
      />

      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Role" value={role} onChange={e => setRole(e.target.value as 'skipper' | 'host')}>
          <option value="skipper">Skipper</option>
          <option value="host">Host</option>
        </SelectField>
        <TextField
          label="Hourly rate (€)"
          type="number"
          step="0.01"
          min="0"
          value={rateEuros}
          onChange={e => setRateEuros(e.target.value)}
          placeholder="22.50"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField label="Phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+31 6 …" />
        <TextField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>

      <TextField
        label="Slack member ID"
        type="text"
        value={slackMemberId}
        onChange={e => setSlackMemberId(e.target.value)}
        placeholder="U0123ABCDEF"
        hint="Slack profile → ⋮ → Copy member ID"
      />

      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Linked login"
          hint="Lets them use the captain portal"
          value={userId}
          onChange={e => setUserId(e.target.value)}
        >
          <option value="">No login</option>
          {captainProfiles.map(p => (
            <option key={p.id} value={p.id}>{p.display_name ?? p.email}</option>
          ))}
        </SelectField>
        <TextField
          label="Max shifts / week"
          type="number"
          min="1"
          value={maxShifts}
          onChange={e => setMaxShifts(e.target.value)}
          placeholder="no limit"
        />
      </div>

      <TextAreaField label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />

      <Field label="Status">
        <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer min-h-[44px] sm:min-h-0">
          <input
            type="checkbox"
            checked={isActive}
            onChange={e => setIsActive(e.target.checked)}
            className="rounded border-zinc-300"
          />
          Active (can be assigned shifts)
        </label>
      </Field>
    </AdminFormModal>
  )
}
