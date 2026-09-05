'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { Field, SelectField } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { BUCKET_LABELS, DEFAULT_PRIORITY, type BucketKey } from '@/lib/finance/cockpit/types'
import { COCKPIT_API, type SettingsPayload, type SettingsRow } from './api-types'
import { MoneyField } from './MoneyField'
import { eurosToCents, centsToEuros, eur } from './money'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  settings: SettingsRow | null
}

const SALARY_MONTH_OPTIONS = [1, 2, 3, 4, 6]

/** Build the full PUT body from a settings row plus overrides — the route replaces, so send everything. */
export function settingsPayloadFrom(settings: SettingsRow, overrides: Partial<SettingsPayload> = {}): SettingsPayload {
  return {
    planning_horizon: settings.planning_horizon,
    safety_margin_cents: settings.safety_margin_cents,
    operational_coverage_cents: settings.operational_coverage_cents,
    owner_salary_monthly_cents: settings.owner_salary_monthly_cents,
    owner_salary_months: settings.owner_salary_months,
    owner_salary_coverage_cents: settings.owner_salary_coverage_cents,
    manual_cash_cents: settings.manual_cash_cents,
    allocation_priority: Array.isArray(settings.allocation_priority) && settings.allocation_priority.length > 0
      ? settings.allocation_priority
      : DEFAULT_PRIORITY,
    marketing_reserve_pct: settings.marketing_reserve_pct,
    snelstart_auto_forward: settings.snelstart_auto_forward,
    ...overrides,
  }
}

/**
 * The knobs of the formula: safety margin, operational coverage, owner salary
 * (monthly × months = target, plus the stored coverage buffer) and the order
 * in which cleared cash fills the buckets.
 */
export function SettingsModal({ open, onClose, onSaved, settings }: SettingsModalProps) {
  const { saving, error, setError, run } = useAdminSave()

  const [safetyMargin, setSafetyMargin] = useState('')
  const [operational, setOperational] = useState('')
  const [salaryMonthly, setSalaryMonthly] = useState('')
  const [salaryMonths, setSalaryMonths] = useState('3')
  const [salaryCoverage, setSalaryCoverage] = useState('')
  const [priority, setPriority] = useState<BucketKey[]>(DEFAULT_PRIORITY)
  const [marketingReservePct, setMarketingReservePct] = useState(25)
  const [autoForward, setAutoForward] = useState(true)

  useEffect(() => {
    if (!open || !settings) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSafetyMargin(centsToEuros(settings.safety_margin_cents))
    setOperational(centsToEuros(settings.operational_coverage_cents))
    setSalaryMonthly(centsToEuros(settings.owner_salary_monthly_cents))
    setSalaryMonths(String(settings.owner_salary_months))
    setSalaryCoverage(centsToEuros(settings.owner_salary_coverage_cents))
    setPriority(settingsPayloadFrom(settings).allocation_priority)
    setMarketingReservePct(settings.marketing_reserve_pct)
    setAutoForward(settings.snelstart_auto_forward)
    setError(null)
  }, [open, settings, setError])

  function move(index: number, dir: -1 | 1) {
    setPriority(prev => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const monthlyCents = eurosToCents(salaryMonthly) ?? 0
  const targetCents = monthlyCents * (Number(salaryMonths) || 0)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    const safety = eurosToCents(safetyMargin)
    const operationalCents = eurosToCents(operational) ?? 0
    const coverageCents = eurosToCents(salaryCoverage) ?? 0
    if (safety == null || safety < 0) { setError('Vul een geldige veiligheidsmarge in.'); return }
    if (operationalCents < 0 || monthlyCents < 0 || coverageCents < 0) { setError('Bedragen kunnen niet negatief zijn.'); return }

    const payload = settingsPayloadFrom(settings, {
      safety_margin_cents: safety,
      operational_coverage_cents: operationalCents,
      owner_salary_monthly_cents: monthlyCents,
      owner_salary_months: Number(salaryMonths),
      owner_salary_coverage_cents: coverageCents,
      allocation_priority: priority,
      marketing_reserve_pct: marketingReservePct,
      snelstart_auto_forward: autoForward,
    })

    run(async () => {
      await adminMutate(`${COCKPIT_API}/settings`, 'PUT', payload)
      onSaved()
      onClose()
    })
  }

  return (
    <AdminFormModal
      open={open}
      title="Instellingen financiële ruimte"
      subtitle="De vaste getallen achter de berekening."
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel="Opslaan"
      submitDisabled={!settings}
      maxWidthClass="max-w-lg"
    >
      <MoneyField
        label="Gewenste veiligheidsmarge"
        value={safetyMargin}
        onChange={setSafetyMargin}
        hint="Wat je ná alle reserveringen nog op de rekening wilt laten staan."
      />
      <MoneyField
        label="Operationele dekking"
        value={operational}
        onChange={setOperational}
        hint="Minimale cash om te blijven draaien (≈ 1 maand operationele kosten)."
      />

      <div className="rounded-xl border border-zinc-200 p-3 space-y-3">
        <p className="text-xs font-semibold text-zinc-700">Eigenaarssalaris</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MoneyField label="Per maand" value={salaryMonthly} onChange={setSalaryMonthly} />
          <SelectField label="Maanden dekking" value={salaryMonths} onChange={e => setSalaryMonths(e.target.value)}>
            {SALARY_MONTH_OPTIONS.map(m => <option key={m} value={m}>{m} {m === 1 ? 'maand' : 'maanden'}</option>)}
          </SelectField>
        </div>
        <MoneyField
          label="Nu gereserveerd voor salaris"
          value={salaryCoverage}
          onChange={setSalaryCoverage}
          hint={`Doel: ${eur(targetCents)}. Dit is het bedrag dat de formule aftrekt.`}
        />
      </div>

      <Field label="Volgorde van vullen" hint="Zo vult het saldo de potjes, van boven naar beneden. Raakt het geld op, dan blijft het laatste potje onderdekt.">
        <ol className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
          {priority.map((key, i) => (
            <li key={key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="w-5 text-xs text-zinc-400 tabular-nums">{i + 1}.</span>
                {BUCKET_LABELS[key]}
              </span>
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Omhoog" className="p-2 rounded-md text-zinc-500 hover:bg-zinc-100 disabled:opacity-30">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === priority.length - 1} aria-label="Omlaag" className="p-2 rounded-md text-zinc-500 hover:bg-zinc-100 disabled:opacity-30">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </Field>

      <Field
        label="Marketingreserve"
        hint="Dit deel van 'beschikbaar voor groei' wordt nooit toegewezen aan salaris of doelen — blijft vrij besteedbaar aan marketing. 0% = alles kan worden toegewezen."
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={marketingReservePct}
            onChange={e => setMarketingReservePct(Number(e.target.value))}
            className="flex-1 accent-zinc-900"
            aria-label="Marketingreserve percentage"
          />
          <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-900">{marketingReservePct}%</span>
        </div>
      </Field>

      <Field
        label="Automatisch naar SnelStart"
        hint="Elk uur gaat het originele document van een uitgave die 'Klaar voor SnelStart' is naar de boekhoudmailbox — één keer, nooit dubbel. Uit = alleen handmatig 'Doorsturen' vanuit Uitgaven."
      >
        <label className="flex items-center gap-3 min-h-[44px] sm:min-h-0 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoForward}
            onChange={e => setAutoForward(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900"
          />
          <span className="text-sm text-zinc-700">{autoForward ? 'Aan — klaarstaande documenten worden elk uur doorgestuurd' : 'Uit — alleen handmatig doorsturen'}</span>
        </label>
      </Field>
    </AdminFormModal>
  )
}
