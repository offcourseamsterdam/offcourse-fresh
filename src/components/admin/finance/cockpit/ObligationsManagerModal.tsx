'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Pencil, Plus, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/admin/ui/fields'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { OBLIGATION_KIND_LABELS, type ObligationKind } from '@/lib/finance/cockpit/types'
import type { RecurringProposal, RecurrenceInterval } from '@/lib/finance/cockpit/derived/recurring'
import type { CityTaxAccrual } from '@/lib/finance/cockpit/derived/city-tax'
import type { VatObligationProposal } from '@/lib/finance/cockpit/derived/vat'
import type { SkipperAccrualResult, SkipperMonthAccrual } from '@/lib/finance/cockpit/derived/skipper-hours'
import type { CateringPeriodEstimate } from '@/lib/finance/cockpit/derived/catering-cost'
import { COCKPIT_API, type ObligationApiRow } from './api-types'
import { ObligationModal } from './ObligationModal'
import { eur, dateNL } from './money'
import { useBoats, boatName } from './useBoats'
import { intervalLabelNL, recurrenceLabelNL } from './interval-label'

const DERIVED_API = `${COCKPIT_API}/obligations/derived`

interface ObligationsManagerModalProps {
  open: boolean
  onClose: () => void
  /** A derived proposal was confirmed, or a manual obligation changed — refresh the dashboard. */
  onChanged: () => void
}

type TabKey = 'overview' | 'add' | 'recurring' | 'city-tax' | 'vat' | 'skipper' | 'catering'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overzicht' },
  { key: 'add', label: 'Toevoegen' },
  { key: 'recurring', label: 'Terugkerende lasten' },
  { key: 'city-tax', label: 'Toeristenbelasting' },
  { key: 'vat', label: 'BTW' },
  { key: 'skipper', label: 'Schippersuren' },
  { key: 'catering', label: 'Cateringinkoop' },
]

/** kinds that make sense for a hand-recognised standing charge — not loan/tax/salary/crew. */
const RECURRING_KIND_OPTIONS: ObligationKind[] = ['insurance', 'berth', 'contract', 'other']

function guessObligationKind(category: string | null, subcategory: string | null): ObligationKind {
  if (subcategory === 'insurance') return 'insurance'
  if (subcategory === 'mooring') return 'berth'
  if (category === 'operating') return 'contract'
  return 'other'
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()
  return {
    from: `${y}-${String(m + 1).padStart(2, '0')}-01`,
    to: `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

function monthLabelNL(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="text-xs text-red-600">{message}</p>
}

function Loading() {
  return <p className="text-sm text-zinc-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Laden…</p>
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = value >= 0.8 ? 'bg-emerald-100 text-emerald-700' : value >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-600'
  return <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${tone}`}>{pct}%</span>
}

function ProvisionalBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0">
      loopt nog
    </span>
  )
}

interface SelectRowProps {
  checked: boolean
  onToggle: () => void
  disabled?: boolean
  children: React.ReactNode
}

function SelectRow({ checked, onToggle, disabled, children }: SelectRowProps) {
  return (
    <label
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
        checked ? 'border-indigo-300 bg-indigo-50/40' : 'border-zinc-200'
      } ${disabled ? 'opacity-50' : 'cursor-pointer hover:border-zinc-300'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="mt-1 w-4 h-4 shrink-0 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
      />
      <div className="flex-1 min-w-0">{children}</div>
    </label>
  )
}

function SelectionBar({ count, onSelectAll, onClear, onConfirm, saving }: {
  count: number
  onSelectAll: () => void
  onClear: () => void
  onConfirm: () => void
  saving: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <button type="button" onClick={count > 0 ? onClear : onSelectAll} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
        {count > 0 ? 'Selectie wissen' : 'Alles selecteren'}
      </button>
      <Button size="sm" onClick={onConfirm} disabled={count === 0 || saving}>
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Bevestigen{count > 0 ? ` (${count})` : ''}
      </Button>
    </div>
  )
}

// ── Overzicht ────────────────────────────────────────────────────────────────

function OverviewTab({ onEdit, onAdd, onChanged }: { onEdit: (row: ObligationApiRow) => void; onAdd: () => void; onChanged: () => void }) {
  const { data, isLoading, error, refresh } = useAdminFetch<ObligationApiRow[]>(`${COCKPIT_API}/obligations?status=open`)
  const boats = useBoats()
  const { error: actionError, run } = useAdminSave()
  const rows = data ?? []

  function markPaid(row: ObligationApiRow) {
    run(async () => {
      await adminMutate(`${COCKPIT_API}/obligations/${row.id}/mark-paid`, 'POST', {})
      refresh()
      onChanged()
    })
  }

  function cancel(row: ObligationApiRow) {
    if (!window.confirm(`"${row.title}" annuleren? De verplichting verdwijnt uit de berekening.`)) return
    run(async () => {
      await adminMutate(`${COCKPIT_API}/obligations/${row.id}`, 'DELETE')
      refresh()
      onChanged()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">{rows.length === 0 ? 'Geen open verplichtingen' : `${rows.length} open`}</p>
        <Button size="sm" variant="outline" onClick={onAdd}><Plus className="w-3.5 h-3.5" /> Toevoegen</Button>
      </div>
      <ErrorLine message={actionError} />
      {isLoading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorLine message={error} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Niets om te beheren — alles is betaald of geannuleerd.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 -mx-1">
          {rows.map(row => {
            const boat = boatName(boats, row.boat_id)
            const recurrence = recurrenceLabelNL(row.recurrence_months)
            return (
              <li key={row.id} className="px-1 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900 truncate">{row.title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{OBLIGATION_KIND_LABELS[row.kind]}</span>
                    <span>·</span>
                    <span>{dateNL(row.due_date)}</span>
                    {recurrence && <><span>·</span><span>{recurrence}</span></>}
                    {boat && <><span>·</span><span>{boat}</span></>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-sm font-semibold tabular-nums text-zinc-900">{eur(row.amount_cents)}</span>
                  <div className="flex items-center gap-0.5">
                    <button type="button" onClick={() => markPaid(row)} className="text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 rounded-md px-1.5 py-1">
                      Betaald
                    </button>
                    <button type="button" onClick={() => onEdit(row)} aria-label="Bewerken" className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => cancel(row)} aria-label="Annuleren" className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50">
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function AddTab({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-center space-y-3">
      <p className="text-sm text-zinc-600">
        Een bedrag dat op een vaste datum de deur uit moet — bijvoorbeeld een nieuwe verzekering, contract of eenmalige rekening.
      </p>
      <Button size="sm" onClick={onAdd}><Plus className="w-3.5 h-3.5" /> Nieuwe verplichting</Button>
    </div>
  )
}

// ── Terugkerende lasten ──────────────────────────────────────────────────────

interface RecurringResponse {
  proposals: RecurringProposal[]
}

function RecurringTab({ onChanged }: { onChanged: () => void }) {
  const { data, isLoading, error, refresh } = useAdminFetch<RecurringResponse>(`${DERIVED_API}/recurring?months=6`)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [kindByKey, setKindByKey] = useState<Record<string, ObligationKind>>({})
  const { saving, error: saveError, run } = useAdminSave()

  const proposals = data?.proposals ?? []

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function confirm() {
    if (selected.size === 0) return
    run(async () => {
      const selections = proposals
        .filter(p => selected.has(p.key))
        .map(p => ({ key: p.key, kind: kindByKey[p.key] ?? guessObligationKind(p.category, p.subcategory), proposal: p }))
      await adminMutate(`${DERIVED_API}/recurring`, 'POST', { selections })
      setSelected(new Set())
      refresh()
      onChanged()
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Automatisch herkend uit de bankfeed: dezelfde tegenpartij, een vast ritme, een stabiel bedrag. Een voorstel wordt pas een
        verplichting nadat je hem hier bevestigt.
      </p>
      <ErrorLine message={saveError} />
      {isLoading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorLine message={error} />
      ) : proposals.length === 0 ? (
        <p className="text-sm text-zinc-500">Geen terugkerende lasten herkend in de laatste 6 maanden.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {proposals.map(p => (
              <SelectRow key={p.key} checked={selected.has(p.key)} onToggle={() => toggle(p.key)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate">{p.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>{intervalLabelNL(p.intervalMonths as RecurrenceInterval)}</span>
                      <span>·</span>
                      <span>volgende keer {dateNL(p.nextExpected)}</span>
                      <span>·</span>
                      <span>{p.occurrences}× gezien</span>
                    </p>
                    {p.amountVaries && (
                      <p className="text-xs text-amber-700 mt-0.5">wisselt tussen {eur(p.minAmountCents)} en {eur(p.maxAmountCents)}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-sm font-semibold tabular-nums text-zinc-900">{eur(p.amountCents)}</span>
                    <ConfidenceBadge value={p.confidence} />
                  </div>
                </div>
                <div className="mt-2 max-w-[220px]" onClick={e => e.preventDefault()}>
                  <SelectField
                    label="Soort verplichting"
                    value={kindByKey[p.key] ?? guessObligationKind(p.category, p.subcategory)}
                    onChange={e => setKindByKey(prev => ({ ...prev, [p.key]: e.target.value as ObligationKind }))}
                  >
                    {RECURRING_KIND_OPTIONS.map(k => <option key={k} value={k}>{OBLIGATION_KIND_LABELS[k]}</option>)}
                  </SelectField>
                </div>
              </SelectRow>
            ))}
          </ul>
          <SelectionBar
            count={selected.size}
            onSelectAll={() => setSelected(new Set(proposals.map(p => p.key)))}
            onClear={() => setSelected(new Set())}
            onConfirm={confirm}
            saving={saving}
          />
        </>
      )}
    </div>
  )
}

// ── Toeristenbelasting ───────────────────────────────────────────────────────

interface CityTaxProposalRow {
  key: string
  title: string
  amountCents: number
  dueDate: string
  isProvisional: boolean
}

interface CityTaxResponse {
  accrual: CityTaxAccrual
  proposals: CityTaxProposalRow[]
}

function CityTaxTab({ onChanged }: { onChanged: () => void }) {
  const year = new Date().getFullYear()
  const { data, isLoading, error, refresh } = useAdminFetch<CityTaxResponse>(`${DERIVED_API}/city-tax?year=${year}`)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { saving, error: saveError, run } = useAdminSave()

  const proposals = data?.proposals ?? []
  const excluded = data?.accrual.excluded

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function confirm() {
    if (selected.size === 0) return
    run(async () => {
      await adminMutate(`${DERIVED_API}/city-tax`, 'POST', { keys: [...selected] })
      setSelected(new Set())
      refresh()
      onChanged()
    })
  }

  return (
    <div className="space-y-4">
      <ErrorLine message={saveError} />
      {isLoading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorLine message={error} />
      ) : (
        <>
          <div>
            <p className="text-xs font-semibold text-zinc-700 mb-2">Per kwartaal — {year}</p>
            <ul className="divide-y divide-zinc-100 -mx-1">
              {data?.accrual.quarters.map(q => (
                <li key={q.key} className="px-1 py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900 flex items-center gap-2">
                      {q.key}
                      {!q.isClosed && <ProvisionalBadge />}
                    </p>
                    <p className="text-xs text-zinc-500">{q.taxableGuests} belastbaar van {q.guests} gasten ({q.exemptGuests} vrijgesteld)</p>
                  </div>
                  <span className="tabular-nums font-semibold text-zinc-900 shrink-0">{eur(q.amountCents)}</span>
                </li>
              ))}
            </ul>
            {excluded && (excluded.notActive > 0 || excluded.noGuestCount > 0 || excluded.untrackedSources.length > 0) && (
              <p className="text-xs text-zinc-400 mt-2">
                Niet meegeteld: {excluded.notActive} niet-actieve boeking{excluded.notActive === 1 ? '' : 'en'}, {excluded.noGuestCount} zonder gastenaantal
                {excluded.untrackedSources.length > 0 && ` · geen zicht op: ${excluded.untrackedSources.join(', ')}`}.
              </p>
            )}
          </div>

          {proposals.length === 0 ? (
            <p className="text-sm text-zinc-500">Niets om als verplichting toe te voegen — alle kwartalen staan op € 0 of zijn al bevestigd.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-700">Toevoegen als verplichting</p>
              <ul className="space-y-2">
                {proposals.map(p => (
                  <SelectRow key={p.key} checked={selected.has(p.key)} onToggle={() => toggle(p.key)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900">{p.title}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">vervaldatum {dateNL(p.dueDate)}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-zinc-900 shrink-0">{eur(p.amountCents)}</span>
                    </div>
                  </SelectRow>
                ))}
              </ul>
              <SelectionBar
                count={selected.size}
                onSelectAll={() => setSelected(new Set(proposals.map(p => p.key)))}
                onClear={() => setSelected(new Set())}
                onConfirm={confirm}
                saving={saving}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── BTW ──────────────────────────────────────────────────────────────────────

interface VatResponse {
  proposals: VatObligationProposal[]
}

function VatTab({ onChanged }: { onChanged: () => void }) {
  const { data, isLoading, error, refresh } = useAdminFetch<VatResponse>(`${DERIVED_API}/vat`)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { saving, error: saveError, run } = useAdminSave()

  const proposals = data?.proposals ?? []

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function confirm() {
    if (selected.size === 0) return
    run(async () => {
      await adminMutate(`${DERIVED_API}/vat`, 'POST', { keys: [...selected] })
      setSelected(new Set())
      refresh()
      onChanged()
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Op basis van het bestaande BTW-overzicht (alle kasboekbronnen). Een teruggaaf-kwartaal wordt nooit voorgesteld.</p>
      <ErrorLine message={saveError} />
      {isLoading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorLine message={error} />
      ) : proposals.length === 0 ? (
        <p className="text-sm text-zinc-500">Geen kwartaal met per saldo verschuldigde BTW.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {proposals.map(p => (
              <SelectRow key={p.key} checked={selected.has(p.key)} onToggle={() => toggle(p.key)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 flex items-center gap-2">
                      {p.quarter}
                      {p.isProvisional && <ProvisionalBadge />}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">vervaldatum {dateNL(p.dueDate)}</p>
                    <dl className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3">
                      {p.vat9Cents > 0 && <span>Laag 9%: {eur(p.vat9Cents)}</span>}
                      {p.vat21Cents > 0 && <span>Hoog 21%: {eur(p.vat21Cents)}</span>}
                      {p.vat21DeductibleCents > 0 && <span>Aftrekbaar: −{eur(p.vat21DeductibleCents)}</span>}
                    </dl>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-zinc-900 shrink-0">{eur(p.amountCents)}</span>
                </div>
              </SelectRow>
            ))}
          </ul>
          <SelectionBar
            count={selected.size}
            onSelectAll={() => setSelected(new Set(proposals.map(p => p.key)))}
            onClear={() => setSelected(new Set())}
            onConfirm={confirm}
            saving={saving}
          />
        </>
      )}
    </div>
  )
}

// ── Schippersuren ────────────────────────────────────────────────────────────

interface SkipperResponse {
  result: SkipperAccrualResult
}

interface PayoutRunLine {
  staffId: string
  staffName: string
  amountCents: number
  hours: number
  reference: string
}

interface PayoutRunBlocked {
  staffId: string
  staffName: string
  reason: string
}

interface PayoutRunResponse {
  month: string
  lines: PayoutRunLine[]
  totalCents: number
  blocked: PayoutRunBlocked[]
}

function skipperKey(r: SkipperMonthAccrual): string {
  return `${r.month}::${r.staffId}`
}

function groupSkipperByMonth(rows: SkipperMonthAccrual[]): Array<{ month: string; rows: SkipperMonthAccrual[] }> {
  const map = new Map<string, SkipperMonthAccrual[]>()
  for (const r of rows) {
    const list = map.get(r.month)
    if (list) list.push(r)
    else map.set(r.month, [r])
  }
  return [...map.entries()].map(([month, monthRows]) => ({ month, rows: monthRows })).sort((a, b) => (a.month < b.month ? 1 : -1))
}

function SkipperTab({ onChanged }: { onChanged: () => void }) {
  const { data, isLoading, error, refresh } = useAdminFetch<SkipperResponse>(`${DERIVED_API}/skipper-hours?months=3`)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { saving, error: saveError, run } = useAdminSave()

  const result = data?.result
  const rows = result?.months ?? []
  const groups = groupSkipperByMonth(rows)
  const closedMonths = [...new Set(rows.filter(r => r.isClosed).map(r => r.month))].sort()
  const latestClosedMonth = closedMonths[closedMonths.length - 1] ?? null

  const { data: payout } = useAdminFetch<PayoutRunResponse>(
    latestClosedMonth ? `${DERIVED_API}/skipper-hours/payout-run?month=${latestClosedMonth}` : null,
  )

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function confirm() {
    if (selected.size === 0) return
    run(async () => {
      const selections = [...selected].map(key => {
        const [month, staffId] = key.split('::')
        return { month, staffId }
      })
      await adminMutate(`${DERIVED_API}/skipper-hours`, 'POST', { selections })
      setSelected(new Set())
      refresh()
      onChanged()
    })
  }

  const warnings = result?.warnings
  const hasWarnings = warnings != null && (warnings.unassignedShifts > 0 || warnings.staffWithoutRate.length > 0 || warnings.openTimeEntries > 0)
  // The API skips a selection outright when any part of its hours is unpriced
  // (finance_obligations would understate what's owed), so only fully-priced
  // rows can be confirmed here.
  const selectableRows = rows.filter(r => r.amountCents > 0 && r.unpricedHours === 0)

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Uit shifts en geklokte uren, geprijsd op het uurtarief dat gold bij het inklokken. Een gevaren uur is meteen een schuld —
        ook zonder factuur.
      </p>
      <ErrorLine message={saveError} />

      {hasWarnings && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <ul className="text-xs text-amber-800 space-y-0.5">
            {warnings!.unassignedShifts > 0 && <li>{warnings!.unassignedShifts} dienst{warnings!.unassignedShifts === 1 ? '' : 'en'} zonder toegewezen schipper.</li>}
            {warnings!.staffWithoutRate.length > 0 && <li>Geen uurtarief ingesteld voor: {warnings!.staffWithoutRate.join(', ')}.</li>}
            {warnings!.openTimeEntries > 0 && <li>{warnings!.openTimeEntries} geklokte dienst{warnings!.openTimeEntries === 1 ? '' : 'en'} nog niet uitgeklokt.</li>}
          </ul>
        </div>
      )}

      {isLoading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorLine message={error} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Geen schippersuren gevonden in de laatste 3 maanden.</p>
      ) : (
        <>
          <div className="space-y-4">
            {groups.map(group => (
              <div key={group.month}>
                <p className="text-xs font-semibold text-zinc-700 mb-2 capitalize">{monthLabelNL(group.month)}</p>
                <ul className="space-y-2">
                  {group.rows.map(r => (
                    <SelectRow key={skipperKey(r)} checked={selected.has(skipperKey(r))} onToggle={() => toggle(skipperKey(r))} disabled={r.amountCents <= 0 || r.unpricedHours > 0}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-900 truncate">{r.staffName}</p>
                          <p className="text-xs text-zinc-500 mt-0.5">{r.hours} uur{!r.isClosed && ' · maand loopt nog'}</p>
                          {r.unpricedHours > 0 && (
                            <p className="text-xs text-amber-700 mt-0.5">{r.unpricedHours} uur geen tarief ingesteld — niet meegeteld</p>
                          )}
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-zinc-900 shrink-0">{eur(r.amountCents)}</span>
                      </div>
                    </SelectRow>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {selectableRows.length > 0 && (
            <SelectionBar
              count={selected.size}
              onSelectAll={() => setSelected(new Set(selectableRows.map(skipperKey)))}
              onClear={() => setSelected(new Set())}
              onConfirm={confirm}
              saving={saving}
            />
          )}
        </>
      )}

      {latestClosedMonth && payout && (
        <div className="rounded-xl border border-zinc-200 p-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-700">
            Uitbetalen — voorbeeld voor {monthLabelNL(latestClosedMonth)}
          </p>
          <p className="text-[11px] text-zinc-400">Alleen een voorbeeld van de batch-uitbetaling — er wordt hier nog niets betaald.</p>
          {payout.lines.length === 0 ? (
            <p className="text-sm text-zinc-500">Niemand om uit te betalen.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 -mx-1">
              {payout.lines.map(l => (
                <li key={l.staffId} className="px-1 py-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-900">{l.staffName} <span className="text-xs text-zinc-400">({l.hours} uur)</span></span>
                  <span className="tabular-nums font-medium text-zinc-900">{eur(l.amountCents)}</span>
                </li>
              ))}
              <li className="px-1 py-1.5 flex items-center justify-between gap-3 text-sm font-semibold border-t border-zinc-200 mt-1 pt-2">
                <span>Totaal</span>
                <span className="tabular-nums">{eur(payout.totalCents)}</span>
              </li>
            </ul>
          )}
          {payout.blocked.length > 0 && (
            <p className="text-xs text-amber-700">
              Niet meegenomen: {payout.blocked.map(b => `${b.staffName} (${b.reason})`).join(', ')}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Cateringinkoop ───────────────────────────────────────────────────────────

/**
 * The route (obligations/derived/catering) always answers
 * `{ estimate: CateringPeriodEstimate, note: string }` — `note` explains the
 * markup assumption. The `perExtra` shape is kept only as a defensive fallback
 * in case that ever changes; nothing today returns it.
 */
interface CateringEstimateResponse {
  estimate: CateringPeriodEstimate | { perExtra: unknown[]; note: string }
  note?: string
}

function isFullEstimate(e: CateringEstimateResponse['estimate']): e is CateringPeriodEstimate {
  return 'estimatedCostCents' in e
}

function CateringTab() {
  const { from, to } = currentMonthRange()
  const { data, isLoading, error } = useAdminFetch<CateringEstimateResponse>(`${DERIVED_API}/catering?from=${from}&to=${to}`)

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        {data?.note ?? 'Een schatting, geen feit: elke cateringprijs is kostprijs × 1,30. Zodra er echte inkoopfacturen zijn (Finance Inbox), vervangen die dit getal volledig.'}
      </p>
      {isLoading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorLine message={error} />
      ) : !data?.estimate ? (
        <p className="text-sm text-zinc-500">Geen catering verkocht deze maand.</p>
      ) : isFullEstimate(data.estimate) ? (
        <div className="rounded-xl border border-zinc-200 p-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-zinc-500">Geschatte inkoop</p>
            <p className="text-lg font-semibold text-zinc-900 tabular-nums">{eur(data.estimate.estimatedCostCents)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Verkocht voor</p>
            <p className="text-lg font-semibold text-zinc-900 tabular-nums">{eur(data.estimate.estimatedSellCents)}</p>
          </div>
          <p className="col-span-2 text-xs text-zinc-400">{data.estimate.lineCount} verkochte regels deze maand.</p>
          {data.estimate.unknownExtraIds.length > 0 && (
            <p className="col-span-2 text-xs text-amber-700">{data.estimate.unknownExtraIds.length} extra&apos;s niet meer in de catalogus — niet meegeteld.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">{data.estimate.note}</p>
      )}
    </div>
  )
}

// ── Shell ────────────────────────────────────────────────────────────────────

export function ObligationsManagerModal({ open, onClose, onChanged }: ObligationsManagerModalProps) {
  const [tab, setTab] = useState<TabKey>('overview')
  const [obligationModal, setObligationModal] = useState<{ open: boolean; editing: ObligationApiRow | null }>({ open: false, editing: null })

  if (!open) return null

  function openAdd() {
    setObligationModal({ open: true, editing: null })
  }
  function openEdit(row: ObligationApiRow) {
    setObligationModal({ open: true, editing: row })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-3xl animate-modal-in max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Verplichtingen beheren</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Handmatig toevoegen, of herkende lasten uit je gegevens bevestigen.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Sluiten"
            className="text-zinc-400 hover:text-zinc-600 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 -m-2 sm:m-0 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 sm:px-5 pt-3 border-b border-zinc-100 shrink-0">
          <div className="flex gap-1 overflow-x-auto pb-3 -mx-1 px-1">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={`shrink-0 min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  tab === t.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {tab === 'overview' && <OverviewTab onEdit={openEdit} onAdd={openAdd} onChanged={onChanged} />}
          {tab === 'add' && <AddTab onAdd={openAdd} />}
          {tab === 'recurring' && <RecurringTab onChanged={onChanged} />}
          {tab === 'city-tax' && <CityTaxTab onChanged={onChanged} />}
          {tab === 'vat' && <VatTab onChanged={onChanged} />}
          {tab === 'skipper' && <SkipperTab onChanged={onChanged} />}
          {tab === 'catering' && <CateringTab />}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-100 shrink-0">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 transition-colors">
            Sluiten
          </button>
        </div>
      </div>

      <ObligationModal
        open={obligationModal.open}
        editing={obligationModal.editing}
        onClose={() => setObligationModal({ open: false, editing: null })}
        onSaved={onChanged}
      />
    </div>
  )
}
