'use client'

import { useEffect, useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, SelectField, TextAreaField } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { OBLIGATION_KIND_LABELS, type ObligationKind } from '@/lib/finance/cockpit/types'
import { COCKPIT_API, type ObligationApiRow, type ObligationPayload } from './api-types'
import { MoneyField } from './MoneyField'
import { eurosToCents, centsToEuros } from './money'
import { useBoats } from './useBoats'

interface ObligationModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing?: ObligationApiRow | null
}

/** 'loan' rows are written by the loan schedule, never by hand — the API rejects it. */
const MANUAL_KINDS = (Object.keys(OBLIGATION_KIND_LABELS) as ObligationKind[]).filter(k => k !== 'loan')

const RECURRENCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Eenmalig' },
  { value: '1', label: 'Elke maand' },
  { value: '3', label: 'Elk kwartaal' },
  { value: '6', label: 'Elk half jaar' },
  { value: '12', label: 'Elk jaar' },
]

/** Create / edit one dated obligation (belasting, verzekering, ligplaats, …). */
export function ObligationModal({ open, onClose, onSaved, editing }: ObligationModalProps) {
  const boats = useBoats(open)
  const { saving, error, setError, run } = useAdminSave()

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<ObligationKind>('other')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [recurrence, setRecurrence] = useState('')
  const [recurrenceUntil, setRecurrenceUntil] = useState('')
  const [boatId, setBoatId] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(editing?.title ?? '')
    setKind(editing?.kind ?? 'other')
    setAmount(centsToEuros(editing?.amount_cents ?? null))
    setDueDate(editing?.due_date ?? '')
    setRecurrence(editing?.recurrence_months ? String(editing.recurrence_months) : '')
    setRecurrenceUntil(editing?.recurrence_until ?? '')
    setBoatId(editing?.boat_id ?? '')
    setNotes(editing?.notes ?? '')
    setError(null)
  }, [open, editing, setError])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amountCents = eurosToCents(amount)
    if (!title.trim()) { setError('Vul een omschrijving in.'); return }
    if (amountCents == null || amountCents <= 0) { setError('Vul een bedrag groter dan € 0 in.'); return }
    if (!dueDate) { setError('Kies een vervaldatum.'); return }

    const payload: ObligationPayload = {
      title: title.trim(),
      kind,
      amount_cents: amountCents,
      due_date: dueDate,
      recurrence_months: recurrence ? Number(recurrence) : null,
      recurrence_until: recurrence && recurrenceUntil ? recurrenceUntil : null,
      boat_id: boatId || null,
      notes: notes.trim() || null,
    }

    run(async () => {
      if (editing) {
        await adminMutate(`${COCKPIT_API}/obligations/${editing.id}`, 'PUT', payload)
      } else {
        await adminMutate(`${COCKPIT_API}/obligations`, 'POST', payload)
      }
      onSaved()
      onClose()
    })
  }

  return (
    <AdminFormModal
      open={open}
      title={editing ? 'Verplichting bewerken' : 'Verplichting toevoegen'}
      subtitle="Een bedrag dat op een vaste datum de deur uit moet."
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel={editing ? 'Opslaan' : 'Toevoegen'}
    >
      <TextField label="Omschrijving" value={title} onChange={e => setTitle(e.target.value)} placeholder="bijv. Verzekering Diana" required />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField label="Soort" value={kind} onChange={e => setKind(e.target.value as ObligationKind)}>
          {MANUAL_KINDS.map(k => (
            <option key={k} value={k}>{OBLIGATION_KIND_LABELS[k]}</option>
          ))}
        </SelectField>
        <MoneyField label="Bedrag" value={amount} onChange={setAmount} required />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="Vervaldatum" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required />
        <SelectField label="Herhaling" value={recurrence} onChange={e => setRecurrence(e.target.value)}>
          {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </SelectField>
      </div>

      {recurrence && (
        <TextField
          label="Herhalen tot"
          type="date"
          value={recurrenceUntil}
          onChange={e => setRecurrenceUntil(e.target.value)}
          hint="Leeg = blijft doorlopen."
        />
      )}

      {boats.length > 0 && (
        <SelectField label="Boot" value={boatId} onChange={e => setBoatId(e.target.value)} hint="Leeg = gedeeld / hele bedrijf.">
          <option value="">Gedeeld</option>
          {boats.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
      )}

      <TextAreaField label="Notities" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
    </AdminFormModal>
  )
}
