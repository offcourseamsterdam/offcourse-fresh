'use client'

import { useEffect, useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, SelectField, TextAreaField, Field } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import {
  COCKPIT_API,
  IMPACT_AXIS_LABELS,
  INVESTMENT_TYPE_LABELS,
  type InvestmentApiRow,
  type InvestmentImpact,
  type InvestmentPayload,
  type InvestmentType,
} from './api-types'
import { MoneyField } from './MoneyField'
import { eurosToCents, centsToEuros } from './money'
import { useBoats } from './useBoats'

const AXES: Array<keyof InvestmentImpact> = ['capacity', 'revenue', 'savings', 'reliability', 'lifespan', 'risk', 'urgency', 'confidence']

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing?: InvestmentApiRow | null
}

/**
 * Create / edit an investment candidate.
 *
 * The impact axes are 1–5 scores on purpose. The plan is explicit that a made-up
 * euro return is worse than an honest ranking, so "verwacht rendement" is left
 * blank by default and blank stays null — never silently 0.
 */
export function InvestmentModal({ open, onClose, onSaved, editing }: Props) {
  const boats = useBoats(open)
  const { saving, error, setError, run } = useAdminSave()

  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<InvestmentType>('growth')
  const [boatId, setBoatId] = useState('')
  const [expectedReturn, setExpectedReturn] = useState('')
  const [notes, setNotes] = useState('')
  const [impact, setImpact] = useState<InvestmentImpact>({})

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(editing?.title ?? '')
    setAmount(centsToEuros(editing?.amount_cents ?? null))
    setType(editing?.type ?? 'growth')
    setBoatId(editing?.boat_id ?? '')
    setExpectedReturn(centsToEuros(editing?.expected_return_cents ?? null))
    setNotes(editing?.notes ?? '')
    setImpact(editing?.impact ?? {})
    setError(null)
  }, [open, editing, setError])

  function setAxis(axis: keyof InvestmentImpact, value: string) {
    setImpact(prev => {
      const next = { ...prev }
      if (!value) delete next[axis]
      else (next as Record<string, unknown>)[axis] = Number(value)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amountCents = eurosToCents(amount)
    if (!title.trim()) { setError('Geef de investering een naam.'); return }
    if (amountCents == null || amountCents < 0) { setError('Vul een bedrag in.'); return }

    const payload: InvestmentPayload = {
      title: title.trim(),
      amount_cents: amountCents,
      type,
      impact,
      boat_id: boatId || null,
      // Blank means "niet betrouwbaar te kwantificeren", which is null — not 0.
      expected_return_cents: eurosToCents(expectedReturn),
      notes: notes.trim() || null,
    }

    run(async () => {
      if (editing) await adminMutate(`${COCKPIT_API}/investments/${editing.id}`, 'PUT', payload)
      else await adminMutate(`${COCKPIT_API}/investments`, 'POST', payload)
      onSaved()
      onClose()
    })
  }

  return (
    <AdminFormModal
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={editing ? 'Investering bewerken' : 'Investering toevoegen'}
      submitLabel={editing ? 'Opslaan' : 'Toevoegen'}
      saving={saving}
      error={error}
    >
      <TextField label="Wat is het?" value={title} onChange={e => setTitle(e.target.value)} placeholder="Tweede boot" required />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MoneyField label="Bedrag" value={amount} onChange={setAmount} required />
        <SelectField label="Soort" value={type} onChange={e => setType(e.target.value as InvestmentType)}>
          {Object.entries(INVESTMENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectField label="Boot" value={boatId} onChange={e => setBoatId(e.target.value)} hint="Leeg = niet boot-specifiek">
          <option value="">Niet boot-specifiek</option>
          {boats.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
        <MoneyField
          label="Verwacht rendement"
          value={expectedReturn}
          onChange={setExpectedReturn}
          hint="Leeg laten als je het niet betrouwbaar kunt inschatten"
        />
      </div>

      <Field label="Inschatting (1 = laag, 5 = hoog)" hint="Leeg laten wat je niet kunt beoordelen — een gok is geen inschatting.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {AXES.map(axis => (
            <label key={axis} className="text-xs text-zinc-600">
              <span className="block mb-1">{IMPACT_AXIS_LABELS[axis]}</span>
              <select
                value={(impact[axis] as number | undefined)?.toString() ?? ''}
                onChange={e => setAxis(axis, e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          ))}
        </div>
      </Field>

      <TextAreaField label="Notities" value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
    </AdminFormModal>
  )
}
