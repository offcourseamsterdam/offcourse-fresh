'use client'

import { useState } from 'react'
import { CheckCircle2, History, Loader2, PauseCircle, Pencil, PlayCircle, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import { GoalModal } from '@/components/admin/finance/cockpit/GoalModal'
import {
  COCKPIT_API,
  GOAL_FLEXIBILITY_LABELS,
  GOAL_STATUS_LABELS,
  type FinanceEventRow,
  type GoalApiRow,
  type GoalStatus,
} from '@/components/admin/finance/cockpit/api-types'
import { eur, pct, dateNL, dateTimeNL } from '@/components/admin/finance/cockpit/money'
import { useBoats, boatName } from '@/components/admin/finance/cockpit/useBoats'

type Filter = GoalStatus | 'all'
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'active', label: 'Actief' },
  { value: 'completed', label: 'Voltooid' },
  { value: 'paused', label: 'Gepauzeerd' },
  { value: 'all', label: 'Alle' },
]

const STATUS_STYLE: Record<GoalStatus, string> = {
  active: 'bg-violet-100 text-violet-800',
  completed: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-zinc-100 text-zinc-600',
}

const ACTOR_LABEL: Record<FinanceEventRow['actor'], string> = {
  user: 'jij',
  cron: 'maandelijkse verdeling',
  ai: 'AI',
  webhook: 'bank',
}

/** The per-goal audit trail: every change to funded_cents, who made it, when. */
function GoalHistory({ goalId }: { goalId: string }) {
  const { data, isLoading, error } = useAdminFetch<FinanceEventRow[]>(`${COCKPIT_API}/goals/${goalId}/events`)
  if (isLoading && !data) return <p className="text-xs text-zinc-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Historie laden…</p>
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!data || data.length === 0) return <p className="text-xs text-zinc-400">Nog geen historie.</p>
  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-100 bg-zinc-50/50">
      {data.map(ev => (
        <li key={ev.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="text-zinc-800 font-medium truncate">{ev.event_type.replace(/_/g, ' ')}</p>
            <p className="text-zinc-400">{dateTimeNL(ev.occurred_at)} · {ACTOR_LABEL[ev.actor] ?? ev.actor}</p>
          </div>
          {ev.delta_cents != null && ev.delta_cents !== 0 && (
            <span className={`tabular-nums font-medium shrink-0 ${ev.delta_cents > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {ev.delta_cents > 0 ? '+' : ''}{eur(ev.delta_cents)}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function FinanceGoalsPage() {
  const [filter, setFilter] = useState<Filter>('active')
  const { data, isLoading, error, refresh } = useAdminFetch<GoalApiRow[]>(`${COCKPIT_API}/goals?status=${filter}`)
  const boats = useBoats()
  const { error: actionError, run } = useAdminSave()

  const [modal, setModal] = useState<{ open: boolean; editing: GoalApiRow | null }>({ open: false, editing: null })
  const [historyFor, setHistoryFor] = useState<string | null>(null)

  function complete(g: GoalApiRow) {
    if (!window.confirm(`"${g.name}" als voltooid markeren? De reservering van ${eur(g.funded_cents)} komt vrij uit de berekening.`)) return
    run(async () => {
      await adminMutate(`${COCKPIT_API}/goals/${g.id}/complete`, 'POST', {})
      refresh()
    })
  }

  function setStatus(g: GoalApiRow, status: 'active' | 'paused') {
    run(async () => {
      await adminMutate(`${COCKPIT_API}/goals/${g.id}`, 'PUT', { status })
      refresh()
    })
  }

  function remove(g: GoalApiRow) {
    if (!window.confirm(`"${g.name}" verwijderen?`)) return
    run(async () => {
      await adminMutate(`${COCKPIT_API}/goals/${g.id}`, 'DELETE')
      refresh()
    })
  }

  const goals = data ?? []
  const totalTarget = goals.reduce((s, g) => s + g.target_cents, 0)
  const totalFunded = goals.reduce((s, g) => s + g.funded_cents, 0)

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-6">
      <FinanceSubnav />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Doelen</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Geld dat je apart zet voor iets specifieks. {goals.length > 0 && `${eur(totalFunded)} van ${eur(totalTarget)} gereserveerd.`}
          </p>
        </div>
        <Button size="sm" onClick={() => setModal({ open: true, editing: null })}>
          <Plus className="w-3.5 h-3.5" /> Nieuw doel
        </Button>
      </div>

      <AdminErrorBanner error={error ?? actionError} />

      <div className="-mx-4 sm:mx-0 overflow-x-auto">
        <div role="group" aria-label="Status" className="flex gap-2 px-4 sm:px-0 min-w-max">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={`min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                filter === f.value ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!data && isLoading ? (
        <AdminPageSkeleton />
      ) : goals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">Geen doelen in deze lijst.</p>
          {filter === 'active' && (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setModal({ open: true, editing: null })}>
              <Plus className="w-3.5 h-3.5" /> Eerste doel aanmaken
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {goals.map(g => {
            const p = g.progress
            const boat = boatName(boats, g.boat_id)
            const showHistory = historyFor === g.id
            return (
              <article key={g.id} className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-4 sm:p-5 flex flex-col gap-3 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-zinc-900 truncate">{g.name}</h2>
                    <p className="text-xs text-zinc-500 mt-0.5 flex flex-wrap gap-x-2">
                      <span>Prioriteit {g.priority}</span>
                      <span>·</span>
                      <span>{GOAL_FLEXIBILITY_LABELS[g.flexibility] ?? g.flexibility}</span>
                      {boat && <><span>·</span><span>{boat}</span></>}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[g.status] ?? STATUS_STYLE.paused}`}>
                    {GOAL_STATUS_LABELS[g.status] ?? g.status}
                  </span>
                </div>

                {g.description && <p className="text-sm text-zinc-600">{g.description}</p>}

                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xl font-semibold text-zinc-900 tabular-nums">{eur(g.funded_cents)}</span>
                    <span className="text-xs text-zinc-500 tabular-nums">van {eur(g.target_cents)} · {pct(p.progressPct)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 rounded-full bg-zinc-100 overflow-hidden">
                    <div className={`h-full rounded-full transition-[width] ${g.status === 'completed' ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{ width: `${Math.min(100, Math.max(0, p.progressPct))}%` }} />
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-zinc-500">Nog nodig</dt>
                  <dd className="text-right tabular-nums text-zinc-900">{eur(p.remainingCents)}</dd>
                  <dt className="text-zinc-500">Deadline</dt>
                  <dd className="text-right tabular-nums text-zinc-900">
                    {g.deadline ? `${dateNL(g.deadline)}${p.monthsLeft != null ? ` (${p.monthsLeft} mnd)` : ''}` : '—'}
                  </dd>
                  <dt className="text-zinc-500">Per maand</dt>
                  <dd className="text-right tabular-nums text-zinc-900">{g.monthly_funding_cents > 0 ? eur(g.monthly_funding_cents) : '—'}</dd>
                </dl>

                {g.status === 'active' && p.behindCents > 0 && (
                  <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    {eur(p.behindCents)} achter op schema
                  </p>
                )}
                {g.status === 'active' && p.behindCents <= 0 && p.plannedByNowCents > 0 && (
                  <p className="text-xs text-emerald-700">Op schema</p>
                )}

                <div className="mt-auto pt-1 flex flex-wrap items-center gap-1 border-t border-zinc-100 -mb-1">
                  <button type="button" onClick={() => setModal({ open: true, editing: g })} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-md px-2 py-2">
                    <Pencil className="w-3.5 h-3.5" /> Bewerken
                  </button>
                  {g.status === 'active' && (
                    <button type="button" onClick={() => complete(g)} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded-md px-2 py-2">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Voltooien
                    </button>
                  )}
                  {g.status === 'active' && (
                    <button type="button" onClick={() => setStatus(g, 'paused')} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-md px-2 py-2">
                      <PauseCircle className="w-3.5 h-3.5" /> Pauzeren
                    </button>
                  )}
                  {g.status === 'paused' && (
                    <button type="button" onClick={() => setStatus(g, 'active')} className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:bg-violet-50 rounded-md px-2 py-2">
                      <PlayCircle className="w-3.5 h-3.5" /> Hervatten
                    </button>
                  )}
                  <button type="button" onClick={() => setHistoryFor(showHistory ? null : g.id)} aria-expanded={showHistory} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-md px-2 py-2">
                    <History className="w-3.5 h-3.5" /> {showHistory ? 'Verberg historie' : 'Bekijk historie'}
                  </button>
                  <button type="button" onClick={() => remove(g)} aria-label="Verwijderen" className="ml-auto inline-flex items-center text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md p-2">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {showHistory && <GoalHistory goalId={g.id} />}
              </article>
            )
          })}
        </div>
      )}

      <GoalModal open={modal.open} editing={modal.editing} onClose={() => setModal({ open: false, editing: null })} onSaved={refresh} />
    </div>
  )
}
