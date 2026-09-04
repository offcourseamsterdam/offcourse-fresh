'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { Field, TextField, SelectField, TextAreaField, adminInputClass } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { COCKPIT_API, REPAYMENT_TYPE_LABELS, type LoanApiRow, type LoanPayload, type RepaymentType } from './api-types'
import { MoneyField } from './MoneyField'
import { eurosToCents, centsToEuros } from './money'

interface LoanModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  /** Existing loan → PUT directly (no impact preview). */
  editing?: LoanApiRow | null
  /** Draft to restore after "Terug" from the impact modal. */
  initial?: LoanPayload | null
  /**
   * New loans go through the impact preview first: instead of POSTing, the modal
   * hands the payload to the parent, which opens LoanImpactModal.
   */
  onPreview?: (payload: LoanPayload) => void
}

interface TrancheDraft {
  amount: string
  date: string
  note: string
}

const emptyTranche = (): TrancheDraft => ({ amount: '', date: '', note: '' })

/** Create / edit a loan: the terms the schedule engine needs, plus optional tranches for staged payouts. */
export function LoanModal({ open, onClose, onSaved, editing, initial, onPreview }: LoanModalProps) {
  const { saving, error, setError, run } = useAdminSave()

  const [name, setName] = useState('')
  const [lender, setLender] = useState('')
  const [principal, setPrincipal] = useState('')
  const [rate, setRate] = useState('')
  const [duration, setDuration] = useState('')
  const [interestFree, setInterestFree] = useState('0')
  const [type, setType] = useState<RepaymentType>('linear')
  const [startDate, setStartDate] = useState('')
  const [tranches, setTranches] = useState<TrancheDraft[]>([])
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    const src: Partial<LoanPayload> | null = editing
      ? { ...editing, tranches: editing.tranches ?? undefined }
      : initial ?? null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(src?.name ?? '')
    setLender(src?.lender_name ?? '')
    setPrincipal(centsToEuros(src?.principal_cents ?? null))
    setRate(src?.interest_rate_pct != null ? String(src.interest_rate_pct) : '')
    setDuration(src?.duration_years != null ? String(src.duration_years) : '')
    setInterestFree(String(src?.interest_free_years ?? 0))
    setType(src?.repayment_type ?? 'linear')
    setStartDate(src?.start_date ?? '')
    setTranches((src?.tranches ?? []).map(t => ({ amount: centsToEuros(t.amount_cents), date: t.date, note: t.note ?? '' })))
    setNotes(src?.notes ?? '')
    setError(null)
  }, [open, editing, initial, setError])

  function updateTranche(i: number, patch: Partial<TrancheDraft>) {
    setTranches(prev => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }

  function buildPayload(): LoanPayload | null {
    const principalCents = eurosToCents(principal)
    const ratePct = Number(rate.replace(',', '.'))
    const durationYears = Number(duration)
    const interestFreeYears = Number(interestFree)
    if (!name.trim()) { setError('Geef de lening een naam.'); return null }
    if (!lender.trim()) { setError('Vul de naam van de geldverstrekker in.'); return null }
    if (principalCents == null || principalCents <= 0) { setError('Vul een hoofdsom groter dan € 0 in.'); return null }
    if (!Number.isFinite(ratePct) || ratePct < 0) { setError('Vul een geldig rentepercentage in.'); return null }
    if (!Number.isInteger(durationYears) || durationYears <= 0) { setError('Looptijd moet een heel aantal jaren zijn.'); return null }
    if (!Number.isInteger(interestFreeYears) || interestFreeYears < 0 || interestFreeYears > durationYears) {
      setError('Rentevrije jaren moet tussen 0 en de looptijd liggen.'); return null
    }
    if (!startDate) { setError('Kies een startdatum.'); return null }

    const parsedTranches = tranches
      .filter(t => t.amount.trim() || t.date)
      .map(t => ({ amount_cents: eurosToCents(t.amount) ?? Number.NaN, date: t.date, note: t.note.trim() || undefined }))
    if (parsedTranches.some(t => !Number.isFinite(t.amount_cents) || t.amount_cents <= 0 || !t.date)) {
      setError('Elke tranche heeft een bedrag én een datum nodig.'); return null
    }
    const trancheSum = parsedTranches.reduce((s, t) => s + t.amount_cents, 0)
    if (parsedTranches.length > 0 && trancheSum !== principalCents) {
      setError('De tranches moeten samen precies de hoofdsom zijn.'); return null
    }

    return {
      name: name.trim(),
      lender_name: lender.trim(),
      principal_cents: principalCents,
      interest_rate_pct: ratePct,
      duration_years: durationYears,
      interest_free_years: interestFreeYears,
      repayment_type: type,
      start_date: startDate,
      tranches: parsedTranches.length > 0 ? parsedTranches : undefined,
      notes: notes.trim() || null,
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = buildPayload()
    if (!payload) return

    if (!editing && onPreview) {
      onPreview(payload)
      return
    }

    run(async () => {
      if (editing) {
        await adminMutate(`${COCKPIT_API}/loans/${editing.id}`, 'PUT', payload)
      } else {
        await adminMutate(`${COCKPIT_API}/loans`, 'POST', payload)
      }
      onSaved()
      onClose()
    })
  }

  return (
    <AdminFormModal
      open={open}
      title={editing ? 'Lening bewerken' : 'Lening toevoegen'}
      subtitle="Betalingen vallen op 1 april en 1 oktober; het schema wordt automatisch berekend."
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel={editing ? 'Opslaan' : onPreview ? 'Bekijk impact' : 'Toevoegen'}
      maxWidthClass="max-w-xl"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="Naam" value={name} onChange={e => setName(e.target.value)} placeholder="bijv. Lening Tijs" required />
        <TextField label="Geldverstrekker" value={lender} onChange={e => setLender(e.target.value)} required />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MoneyField label="Hoofdsom" value={principal} onChange={setPrincipal} required />
        <TextField label="Rente (% per jaar)" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} placeholder="bijv. 5" required />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TextField label="Looptijd (jaren)" type="number" min={1} step={1} value={duration} onChange={e => setDuration(e.target.value)} required />
        <TextField label="Rentevrije jaren" type="number" min={0} step={1} value={interestFree} onChange={e => setInterestFree(e.target.value)} />
        <SelectField label="Aflossing" value={type} onChange={e => setType(e.target.value as RepaymentType)}>
          {(Object.keys(REPAYMENT_TYPE_LABELS) as RepaymentType[]).map(t => (
            <option key={t} value={t}>{REPAYMENT_TYPE_LABELS[t]}</option>
          ))}
        </SelectField>
      </div>

      <TextField label="Startdatum" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} hint="De dag waarop het geld (of de eerste tranche) binnenkwam." required />

      <Field label="Tranches" hint="Alleen invullen als het bedrag in delen is uitgekeerd. Samen moeten ze de hoofdsom zijn.">
        <div className="space-y-2">
          {tranches.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] sm:grid-cols-[1fr_1fr_1.4fr_auto] gap-2 items-center">
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400 pointer-events-none">€</span>
                <input type="text" inputMode="decimal" value={t.amount} onChange={e => updateTranche(i, { amount: e.target.value })} placeholder="Bedrag" className={`${adminInputClass} pl-7`} aria-label="Tranchebedrag" />
              </div>
              <input type="date" value={t.date} onChange={e => updateTranche(i, { date: e.target.value })} className={adminInputClass} aria-label="Tranchedatum" />
              <input type="text" value={t.note} onChange={e => updateTranche(i, { note: e.target.value })} placeholder="Notitie" className={`${adminInputClass} col-span-2 sm:col-span-1`} aria-label="Tranchenotitie" />
              <button type="button" onClick={() => setTranches(prev => prev.filter((_, idx) => idx !== i))} aria-label="Tranche verwijderen" className="p-2.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 justify-self-end">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTranches(prev => [...prev, emptyTranche()])}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 px-2 py-2 rounded-lg hover:bg-zinc-100"
          >
            <Plus className="w-3.5 h-3.5" /> Tranche toevoegen
          </button>
        </div>
      </Field>

      <TextAreaField label="Notities" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
    </AdminFormModal>
  )
}
