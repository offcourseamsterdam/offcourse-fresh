'use client'

import { useState } from 'react'
import { AlertTriangle, Calculator, CheckCircle2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import { InvestmentModal } from '@/components/admin/finance/cockpit/InvestmentModal'
import { StatCard } from '@/components/admin/finance/cockpit/StatCard'
import {
  COCKPIT_API,
  IMPACT_AXIS_LABELS,
  INVESTMENT_STATUS_LABELS,
  INVESTMENT_TYPE_LABELS,
  type InvestmentApiRow,
  type InvestmentStatus,
  type ScenarioResult,
} from '@/components/admin/finance/cockpit/api-types'
import { eur, dateNL } from '@/components/admin/finance/cockpit/money'
import { useBoats, boatName } from '@/components/admin/finance/cockpit/useBoats'

type Filter = InvestmentStatus | 'open' | 'all'

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'open', label: 'Op de lijst' },
  { value: 'approved', label: 'Goedgekeurd' },
  { value: 'executed', label: 'Uitgevoerd' },
  { value: 'dropped', label: 'Afgevallen' },
  { value: 'all', label: 'Alle' },
]

const STATUS_STYLE: Record<InvestmentStatus, string> = {
  idea: 'bg-zinc-100 text-zinc-700',
  planned: 'bg-blue-100 text-blue-800',
  approved: 'bg-violet-100 text-violet-800',
  executed: 'bg-emerald-100 text-emerald-800',
  dropped: 'bg-zinc-100 text-zinc-400 line-through',
}

/** Next status in the decision trail: idea → planned → approved → executed. */
const NEXT_STATUS: Partial<Record<InvestmentStatus, InvestmentStatus>> = {
  idea: 'planned',
  planned: 'approved',
  approved: 'executed',
}

/**
 * "Wat als ik dit doe?" — the same computeCockpit the dashboard uses, run again
 * with the spend taken off cash. Never a second formula (plan §2 rule 5).
 * Computed on demand (a POST, so not a useAdminFetch subscription): a what-if
 * has no business polling in the background.
 */
function ScenarioBody({ investment, onClose }: { investment: InvestmentApiRow; onClose: () => void }) {
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const { saving, error, run } = useAdminSave()

  function compute() {
    run(async () => {
      const data = await adminMutate<ScenarioResult>(`${COCKPIT_API}/investments/scenario`, 'POST', { investment_id: investment.id })
      setResult(data)
    })
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Wat als ik dit doe?</p>
        <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-700">Sluiten</button>
      </div>

      {!result && (
        <Button onClick={compute} disabled={saving} variant="secondary" className="text-xs">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />} Doorrekenen
        </Button>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {result && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2">
              <p className="text-zinc-500">Nu beschikbaar voor groei</p>
              <p className="font-semibold text-zinc-900 tabular-nums">{eur(result.before.availableForGrowthCents)}</p>
            </div>
            <div className="rounded-lg bg-white border border-zinc-200 px-3 py-2">
              <p className="text-zinc-500">Deze investering</p>
              <p className="font-semibold text-zinc-900 tabular-nums">−{eur(result.amountCents)}</p>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${result.affordable ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className={result.affordable ? 'text-emerald-700' : 'text-amber-700'}>Daarna over</p>
              <p className={`font-semibold tabular-nums ${result.affordable ? 'text-emerald-800' : 'text-amber-800'}`}>
                {eur(result.after.availableForGrowthCents)}
              </p>
            </div>
          </div>

          <p className={`text-xs flex items-start gap-1.5 ${result.affordable ? 'text-emerald-700' : 'text-amber-800'}`}>
            {result.affordable
              ? <><CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Dit past binnen je ruimte boven de veiligheidsmarge.</>
              : <><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Dit gaat {eur(result.after.marginShortfallCents)} onder je gewenste veiligheidsmarge van {eur(result.after.safetyMarginCents)}.</>}
          </p>
          <p className="text-[11px] text-zinc-400">
            Status daarna: {result.after.status.label}. Berekend met dezelfde formule als het overzicht.
          </p>
        </div>
      )}
    </div>
  )
}

export default function FinanceInvestmentsPage() {
  const [filter, setFilter] = useState<Filter>('open')
  const { data, isLoading, error, refresh } = useAdminFetch<InvestmentApiRow[]>(`${COCKPIT_API}/investments?status=${filter}`)
  const boats = useBoats()
  const { error: actionError, run } = useAdminSave()

  const [modal, setModal] = useState<{ open: boolean; editing: InvestmentApiRow | null }>({ open: false, editing: null })
  const [scenarioFor, setScenarioFor] = useState<string | null>(null)

  const rows = data ?? []
  const openRows = rows.filter(r => r.status === 'idea' || r.status === 'planned' || r.status === 'approved')
  const shortlistTotal = openRows.reduce((s, r) => s + r.amount_cents, 0)

  function setStatus(row: InvestmentApiRow, status: InvestmentStatus) {
    run(async () => {
      await adminMutate(`${COCKPIT_API}/investments/${row.id}`, 'PUT', { status })
      refresh()
    })
  }

  function remove(row: InvestmentApiRow) {
    if (!window.confirm(`"${row.title}" verwijderen?`)) return
    run(async () => {
      await adminMutate(`${COCKPIT_API}/investments/${row.id}`, 'DELETE')
      refresh()
    })
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Investeringen</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Wat je met je groeiruimte zou kunnen doen. Een idee hier reserveert nog niets — pas als je het uitvoert, gaat er geld weg.
        </p>
      </div>

      <FinanceSubnav />
      <AdminErrorBanner error={error ?? actionError} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard title="Op de lijst" value={String(openRows.length)} subtitle="ideeën, gepland en goedgekeurd" />
        <StatCard title="Samen" value={eur(shortlistTotal)} subtitle="als je alles zou doen" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f.value ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button onClick={() => setModal({ open: true, editing: null })} className="text-sm">
          <Plus className="w-4 h-4" /> Investering toevoegen
        </Button>
      </div>

      {isLoading && !data && <AdminPageSkeleton />}

      {data && rows.length === 0 && (
        <p className="text-sm text-zinc-400 py-8 text-center">Nog geen investeringen op deze lijst.</p>
      )}

      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.id} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-zinc-900 truncate">{row.title}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {INVESTMENT_TYPE_LABELS[row.type]}
                  {row.boat_id ? ` · ${boatName(boats, row.boat_id)}` : ''}
                  {` · toegevoegd ${dateNL(row.created_at)}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-zinc-900 tabular-nums">{eur(row.amount_cents)}</p>
                <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[row.status]}`}>
                  {INVESTMENT_STATUS_LABELS[row.status]}
                </span>
              </div>
            </div>

            {Object.keys(row.impact ?? {}).filter(k => k !== 'notes').length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(row.impact ?? {})
                  .filter(([k, v]) => k !== 'notes' && typeof v === 'number')
                  .map(([k, v]) => (
                    <span key={k} className="text-[10px] rounded-full bg-zinc-100 text-zinc-600 px-2 py-0.5">
                      {IMPACT_AXIS_LABELS[k] ?? k} {v}/5
                    </span>
                  ))}
              </div>
            )}

            <p className="mt-2 text-xs text-zinc-500">
              Verwacht rendement:{' '}
              {row.expected_return_cents == null
                ? <span className="text-zinc-400">niet betrouwbaar te kwantificeren</span>
                : <span className="tabular-nums text-zinc-700">{eur(row.expected_return_cents)}</span>}
            </p>
            {row.notes && <p className="mt-1 text-xs text-zinc-600 whitespace-pre-wrap">{row.notes}</p>}

            <div className="mt-2.5 flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setScenarioFor(scenarioFor === row.id ? null : row.id)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline"
              >
                <Calculator className="w-3.5 h-3.5" /> Wat als?
              </button>
              {NEXT_STATUS[row.status] && (
                <button
                  onClick={() => setStatus(row, NEXT_STATUS[row.status] as InvestmentStatus)}
                  className="text-xs text-zinc-600 hover:text-zinc-900 underline"
                >
                  Naar {INVESTMENT_STATUS_LABELS[NEXT_STATUS[row.status] as InvestmentStatus].toLowerCase()}
                </button>
              )}
              {row.status !== 'dropped' && row.status !== 'executed' && (
                <button onClick={() => setStatus(row, 'dropped')} className="text-xs text-zinc-500 hover:text-zinc-700 underline">
                  Laten vallen
                </button>
              )}
              <button
                onClick={() => setModal({ open: true, editing: row })}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700"
              >
                <Pencil className="w-3 h-3" /> Bewerken
              </button>
              <button
                onClick={() => remove(row)}
                className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-3 h-3" /> Verwijderen
              </button>
            </div>

            {scenarioFor === row.id && <ScenarioBody investment={row} onClose={() => setScenarioFor(null)} />}
          </div>
        ))}
      </div>

      <InvestmentModal
        open={modal.open}
        editing={modal.editing}
        onClose={() => setModal({ open: false, editing: null })}
        onSaved={refresh}
      />
    </div>
  )
}
