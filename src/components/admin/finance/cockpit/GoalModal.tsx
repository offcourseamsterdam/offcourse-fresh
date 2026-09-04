'use client'

import { useEffect, useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, SelectField, TextAreaField } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { COCKPIT_API, GOAL_FLEXIBILITY_LABELS, type GoalApiRow, type GoalFlexibility, type GoalPayload } from './api-types'
import { MoneyField } from './MoneyField'
import { eurosToCents, centsToEuros } from './money'
import { useBoats } from './useBoats'

interface GoalModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing?: GoalApiRow | null
}

/** Create / edit a savings goal ("Nieuwe motor Curaçao", "Reserve winterstalling", …). */
export function GoalModal({ open, onClose, onSaved, editing }: GoalModalProps) {
  const boats = useBoats(open)
  const { saving, error, setError, run } = useAdminSave()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState('')
  const [funded, setFunded] = useState('')
  const [deadline, setDeadline] = useState('')
  const [priority, setPriority] = useState('3')
  const [monthly, setMonthly] = useState('')
  const [boatId, setBoatId] = useState('')
  const [flexibility, setFlexibility] = useState<GoalFlexibility>('flexible')

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(editing?.name ?? '')
    setDescription(editing?.description ?? '')
    setTarget(centsToEuros(editing?.target_cents ?? null))
    setFunded(centsToEuros(editing?.funded_cents ?? 0))
    setDeadline(editing?.deadline ?? '')
    setPriority(String(editing?.priority ?? 3))
    setMonthly(centsToEuros(editing?.monthly_funding_cents ?? 0))
    setBoatId(editing?.boat_id ?? '')
    setFlexibility(editing?.flexibility ?? 'flexible')
    setError(null)
  }, [open, editing, setError])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const targetCents = eurosToCents(target)
    const fundedCents = eurosToCents(funded) ?? 0
    const monthlyCents = eurosToCents(monthly) ?? 0
    if (!name.trim()) { setError('Geef het doel een naam.'); return }
    if (targetCents == null || targetCents <= 0) { setError('Vul een doelbedrag groter dan € 0 in.'); return }
    if (fundedCents < 0 || monthlyCents < 0) { setError('Bedragen kunnen niet negatief zijn.'); return }
    if (fundedCents > targetCents) { setError('Gereserveerd kan niet hoger zijn dan het doelbedrag.'); return }

    const payload: GoalPayload = {
      name: name.trim(),
      description: description.trim() || null,
      target_cents: targetCents,
      funded_cents: fundedCents,
      deadline: deadline || null,
      priority: Number(priority),
      monthly_funding_cents: monthlyCents,
      boat_id: boatId || null,
      flexibility,
    }

    run(async () => {
      if (editing) {
        await adminMutate(`${COCKPIT_API}/goals/${editing.id}`, 'PUT', payload)
      } else {
        await adminMutate(`${COCKPIT_API}/goals`, 'POST', payload)
      }
      onSaved()
      onClose()
    })
  }

  return (
    <AdminFormModal
      open={open}
      title={editing ? 'Doel bewerken' : 'Nieuw doel'}
      subtitle="Geld dat je apart zet voor iets specifieks. Gereserveerd telt mee als bestemd geld."
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel={editing ? 'Opslaan' : 'Doel aanmaken'}
      maxWidthClass="max-w-lg"
    >
      <TextField label="Naam" value={name} onChange={e => setName(e.target.value)} placeholder="bijv. Nieuwe accu's Curaçao" required />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MoneyField label="Doelbedrag" value={target} onChange={setTarget} required />
        <MoneyField label="Al gereserveerd" value={funded} onChange={setFunded} hint="Wat je er nu al voor apart hebt staan." />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="Deadline" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} hint="Leeg = geen vaste datum." />
        <MoneyField label="Maandelijks sparen" value={monthly} onChange={setMonthly} hint="Wat de maandelijkse verdeling erbij mag leggen." />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField label="Prioriteit" value={priority} onChange={e => setPriority(e.target.value)} hint="1 = eerst vullen, 5 = mag wachten.">
          {[1, 2, 3, 4, 5].map(p => <option key={p} value={p}>{p}</option>)}
        </SelectField>
        <SelectField label="Flexibiliteit" value={flexibility} onChange={e => setFlexibility(e.target.value as GoalFlexibility)}>
          {(Object.keys(GOAL_FLEXIBILITY_LABELS) as GoalFlexibility[]).map(f => (
            <option key={f} value={f}>{GOAL_FLEXIBILITY_LABELS[f]}</option>
          ))}
        </SelectField>
      </div>

      {boats.length > 0 && (
        <SelectField label="Boot" value={boatId} onChange={e => setBoatId(e.target.value)}>
          <option value="">Gedeeld</option>
          {boats.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
      )}

      <TextAreaField label="Omschrijving" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
    </AdminFormModal>
  )
}
