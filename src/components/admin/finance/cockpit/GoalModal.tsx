'use client'

import { useEffect, useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, SelectField, TextAreaField } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { COCKPIT_API, GOAL_FLEXIBILITY_LABELS, GOAL_TYPE_LABELS, type GoalApiRow, type GoalFlexibility, type GoalPayload, type GoalType } from './api-types'
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

  const [goalType, setGoalType] = useState<GoalType>('target')
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
    let rawDesc = editing?.description ?? ''
    let parsedType: GoalType = editing?.goal_type ?? 'target'
    if (rawDesc.startsWith('{"type":')) {
      try {
        const p = JSON.parse(rawDesc)
        if (p.type) parsedType = p.type
        rawDesc = p.notes ?? ''
      } catch {
        // ignore
      }
    }
    setGoalType(parsedType)
    setName(editing?.name ?? '')
    setDescription(rawDesc)
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
      goal_type: goalType,
      description: description.trim() || null,
      target_cents: targetCents,
      funded_cents: fundedCents,
      deadline: goalType === 'monthly_refill' ? null : (deadline || null),
      priority: Number(priority),
      monthly_funding_cents: goalType === 'monthly_refill' ? 0 : monthlyCents,
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

  function applyMaintenancePreset() {
    setName('Onderhoud Vloot (5% van waarde)')
    setGoalType('sinking_fund')
    // 5% of €202.500 = €10.125
    setTarget('10125')
    setMonthly('843.75')
    setDescription('Jaarlijkse onderhoudsbuffer: 5% van bootwaarde (€ 202.500) opgebouwd naar plafond van € 10.125.')
  }

  function applyOperationsRefillPreset() {
    setName('Operations Fund')
    setGoalType('monthly_refill')
    setTarget('2000')
    setMonthly('0')
    setDescription('Maandelijks aanvulfonds voor operationele uitgaven (brandstof, havengeld, boodschappen). Wordt elke maand aangevuld tot € 2.000.')
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
      {!editing && (
        <div className="flex flex-wrap gap-2 pb-2">
          <button
            type="button"
            onClick={applyOperationsRefillPreset}
            className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
          >
            ⚡ Snelkiezer: Operations Fund (€ 2.000/mnd)
          </button>
          <button
            type="button"
            onClick={applyMaintenancePreset}
            className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
          >
            ⚓ Snelkiezer: Bootonderhoud (5% / € 10.125)
          </button>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-zinc-700 mb-1.5">Type doel</label>
        <div className="grid grid-cols-3 gap-2">
          {(['target', 'sinking_fund', 'monthly_refill'] as GoalType[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setGoalType(t)}
              className={`p-2 rounded-lg border text-left text-xs transition-colors ${
                goalType === t
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
              }`}
            >
              <span className="font-semibold block">{GOAL_TYPE_LABELS[t]}</span>
              <span className={`text-[10px] block mt-0.5 leading-tight ${goalType === t ? 'text-zinc-300' : 'text-zinc-400'}`}>
                {t === 'target' ? 'Eenmalig toewerken' : t === 'sinking_fund' ? 'Buffer met plafond' : 'Elke maand aanvullen'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <TextField label="Naam" value={name} onChange={e => setName(e.target.value)} placeholder="bijv. Nieuwe accu's Curaçao" required />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MoneyField
          label={goalType === 'monthly_refill' ? 'Maandplafond' : goalType === 'sinking_fund' ? 'Plafond (Max buffer)' : 'Doelbedrag'}
          value={target}
          onChange={setTarget}
          required
        />
        <MoneyField label="Al gereserveerd" value={funded} onChange={setFunded} hint="Wat je er nu al voor apart hebt staan." />
      </div>

      {goalType !== 'monthly_refill' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Deadline" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} hint="Leeg = geen vaste datum." />
          <MoneyField label="Maandelijks sparen" value={monthly} onChange={setMonthly} hint="Wat de verdeling maandelijks mag toevoegen." />
        </div>
      )}

      {goalType === 'monthly_refill' && (
        <p className="text-xs text-zinc-500 bg-zinc-50 p-2.5 rounded-lg border border-zinc-200">
          🔄 <strong>YNAB Refill:</strong> Aan het begin van elke maand vult de verdeling dit fonds automatisch aan tot het gekozen maandplafond ({target ? `€ ${target}` : '€ …'}), rekening houdend met wat er al in staat.
        </p>
      )}

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
