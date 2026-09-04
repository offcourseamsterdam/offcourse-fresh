'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw, Settings2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import {
  HORIZON_LABELS,
  OBLIGATION_KIND_LABELS,
  type CockpitResult,
  type Horizon,
  type ObligationOccurrence,
} from '@/lib/finance/cockpit/types'
import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import { StatCard } from '@/components/admin/finance/cockpit/StatCard'
import { StatusPill } from '@/components/admin/finance/cockpit/StatusPill'
import { AllocationBar } from '@/components/admin/finance/cockpit/AllocationBar'
import { WhyDrawer } from '@/components/admin/finance/cockpit/WhyDrawer'
import { ObligationModal } from '@/components/admin/finance/cockpit/ObligationModal'
import { SettingsModal, settingsPayloadFrom } from '@/components/admin/finance/cockpit/SettingsModal'
import { ManualCashModal } from '@/components/admin/finance/cockpit/ManualCashModal'
import { COCKPIT_API, type ObligationApiRow, type SettingsRow } from '@/components/admin/finance/cockpit/api-types'
import { eur, pct, dateNL, dateTimeNL } from '@/components/admin/finance/cockpit/money'
import { useBoats, boatName } from '@/components/admin/finance/cockpit/useBoats'

const HORIZONS: Horizon[] = ['30d', '3m', '12m']
const HORIZON_SHORT: Record<Horizon, string> = { '30d': '30 dagen', '3m': '3 maanden', '12m': '12 maanden' }

const cardClass = 'rounded-2xl border border-zinc-200 bg-white shadow-sm'

export default function FinanceOverviewPage() {
  const params = useParams()
  const locale = (params?.locale as string | undefined) ?? 'en'

  // null = "whatever the settings say" — the API applies the stored horizon.
  const [horizon, setHorizon] = useState<Horizon | null>(null)
  const overviewUrl = horizon ? `${COCKPIT_API}/overview?horizon=${horizon}` : `${COCKPIT_API}/overview`

  const { data, isLoading, error, refresh } = useAdminFetch<CockpitResult>(overviewUrl)
  const { data: settings, refresh: refreshSettings } = useAdminFetch<SettingsRow>(`${COCKPIT_API}/settings`)
  const { data: openObligations, refresh: refreshObligations } = useAdminFetch<ObligationApiRow[]>(`${COCKPIT_API}/obligations?status=open`)
  const boats = useBoats()
  const { error: actionError, run } = useAdminSave()

  const [whyOpen, setWhyOpen] = useState(false)
  const [whyTitle, setWhyTitle] = useState('Waarom dit bedrag?')
  const [obligationModal, setObligationModal] = useState<{ open: boolean; editing: ObligationApiRow | null }>({ open: false, editing: null })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cashOpen, setCashOpen] = useState(false)
  const [showAllObligations, setShowAllObligations] = useState(false)

  const refreshAll = useCallback(() => {
    refresh()
    refreshSettings()
    refreshObligations()
  }, [refresh, refreshSettings, refreshObligations])

  function openWhy(title: string) {
    setWhyTitle(title)
    setWhyOpen(true)
  }

  function changeHorizon(h: Horizon) {
    setHorizon(h)
    if (!settings) return
    run(async () => {
      await adminMutate(`${COCKPIT_API}/settings`, 'PUT', settingsPayloadFrom(settings, { planning_horizon: h }))
      refreshSettings()
    })
  }

  function markPaid(o: ObligationOccurrence) {
    run(async () => {
      if (o.source === 'loan') {
        const paymentId = o.key.replace(/^loan:/, '')
        await adminMutate(`${COCKPIT_API}/loans/${o.sourceId}/payments/${paymentId}/mark-paid`, 'POST', {})
      } else {
        await adminMutate(`${COCKPIT_API}/obligations/${o.sourceId}/mark-paid`, 'POST', {})
      }
      refreshAll()
    })
  }

  function cancelObligation(o: ObligationOccurrence) {
    if (!window.confirm(`"${o.title}" annuleren? De verplichting verdwijnt uit de berekening.`)) return
    run(async () => {
      await adminMutate(`${COCKPIT_API}/obligations/${o.sourceId}`, 'DELETE')
      refreshAll()
    })
  }

  function editObligation(o: ObligationOccurrence) {
    const row = openObligations?.find(r => r.id === o.sourceId) ?? null
    if (!row) return
    setObligationModal({ open: true, editing: row })
  }

  if (!data && isLoading) {
    return (
      <div className="p-4 sm:p-8 max-w-6xl space-y-6">
        <FinanceSubnav />
        <AdminPageSkeleton />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 sm:p-8 max-w-6xl space-y-6">
        <FinanceSubnav />
        <AdminErrorBanner error={error ?? 'Kon het overzicht niet laden.'} />
      </div>
    )
  }

  const activeHorizon = data.horizon
  const cash = data.cash
  const cashKnown = cash.source !== 'none'
  const growthTone = data.availableForGrowthCents > 0 ? 'green' : data.marginShortfallCents > 0 ? 'amber' : 'default'
  const spaceTone = data.financialSpaceCents < 0 ? 'red' : 'default'
  const obligationsTotal = data.obligations.reduce((s, o) => s + o.amountCents, 0)
  const overdueCount = data.obligations.filter(o => o.overdue).length
  const visibleObligations = showAllObligations ? data.obligations : data.obligations.slice(0, 8)
  const topGoals = data.goals.slice(0, 3)
  const salary = data.ownerSalary
  const salaryPct = salary.targetCents > 0 ? (salary.coverageCents / salary.targetCents) * 100 : 0

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-6">
      <FinanceSubnav />

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900">Financieel overzicht</h1>
          <p className="text-sm text-zinc-500 mt-1">Wat kan Off Course verantwoord doen met zijn geld?</p>
          <p className="text-xs text-zinc-400 mt-1">
            Laatst bijgewerkt: {cash.asOf ? `${dateTimeNL(cash.asOf)}${cash.source === 'manual' ? ' (handmatig)' : ''}` : 'geen saldo bekend'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Planningshorizon" className="inline-flex rounded-full border border-zinc-200 bg-white p-1 shadow-sm">
            {HORIZONS.map(h => {
              const active = h === activeHorizon
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => changeHorizon(h)}
                  aria-pressed={active}
                  className={`min-h-[36px] sm:min-h-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    active ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {HORIZON_SHORT[h]}
                </button>
              )
            })}
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={isLoading} aria-label="Ververs">
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Ververs</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Instellingen</span>
          </Button>
        </div>
      </div>

      <AdminErrorBanner error={error ?? actionError} />

      <div className="flex flex-wrap items-center gap-3">
        <StatusPill level={data.status.level} label={data.status.label} reasons={data.status.reasons} />
        <span className="text-xs text-zinc-400">Horizon: {HORIZON_LABELS[activeHorizon]} · tot {dateNL(data.horizonEnd)}</span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cashKnown ? (
          <StatCard
            title={cash.source === 'manual' ? 'Saldo (handmatig)' : 'Cash bij Revolut'}
            value={eur(cash.clearedCents)}
            subtitle={
              cash.pendingOutCents > 0 || cash.pendingInCents > 0
                ? `waarvan ${eur(cash.pendingOutCents)} uitgaand in behandeling`
                : cash.source === 'manual' ? 'Alleen het geboekte saldo telt mee.' : 'Geboekt saldo, EUR-rekening'
            }
            onWhy={() => openWhy('Cash')}
            action={
              cash.source === 'manual' ? (
                <button type="button" onClick={() => setCashOpen(true)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap -my-1 py-1">
                  Saldo invoeren
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className={`${cardClass} p-4 sm:p-5 flex flex-col gap-2 border-dashed`}>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Cash</p>
            <p className="text-sm text-zinc-600">Nog geen saldo — koppel Revolut (fase 2) of vul een saldo in.</p>
            <div className="mt-auto pt-1">
              <Button size="sm" onClick={() => setCashOpen(true)}>Saldo invoeren</Button>
            </div>
          </div>
        )}

        <StatCard
          title="Financiële ruimte vóór veiligheidsmarge"
          value={eur(data.financialSpaceCents)}
          subtitle="Na verplichtingen, operationele dekking, salarisdekking en doelen"
          tone={spaceTone}
          onWhy={() => openWhy('Financiële ruimte vóór veiligheidsmarge')}
        />

        <StatCard
          title="Beschikbaar voor groei"
          value={eur(data.availableForGrowthCents)}
          tone={growthTone}
          note={data.marginShortfallCents > 0 ? `${eur(data.marginShortfallCents)} onder gewenste veiligheidsmarge` : undefined}
          subtitle={`Na veiligheidsmarge van ${eur(data.safetyMarginCents)}`}
          onWhy={() => openWhy('Beschikbaar voor groei')}
        />

        <StatCard
          title="Komende verplichtingen"
          value={eur(obligationsTotal)}
          subtitle={HORIZON_LABELS[activeHorizon]}
          tone={overdueCount > 0 ? 'amber' : 'default'}
          note={overdueCount > 0 ? `${overdueCount} over tijd` : undefined}
          onWhy={() => openWhy('Komende verplichtingen')}
        />
      </div>

      {/* Allocation bar */}
      <section className={`${cardClass} p-4 sm:p-6 space-y-4`}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-zinc-900">Waar is je geld voor bestemd?</h2>
          <span className="text-xs text-zinc-500">Totaal {eur(cash.clearedCents)}</span>
        </div>
        <AllocationBar
          cashCents={cash.clearedCents}
          buckets={data.buckets}
          freeCents={data.freeCents}
          safetyMarginCents={data.safetyMarginCents}
          reserveOverrunCents={data.reserveOverrunCents}
        />
      </section>

      {/* Three cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Obligations */}
        <section className={`${cardClass} p-4 sm:p-5 flex flex-col gap-3 lg:col-span-2 xl:col-span-1`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-zinc-900">Komende verplichtingen</h2>
            <Button size="sm" variant="outline" onClick={() => setObligationModal({ open: true, editing: null })}>
              <Plus className="w-3.5 h-3.5" /> Toevoegen
            </Button>
          </div>
          {data.obligations.length === 0 ? (
            <p className="text-sm text-zinc-500">Niets gepland in deze horizon.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 -mx-1">
              {visibleObligations.map(o => {
                const boat = boatName(boats, o.boatId)
                const paymentPending = o.source === 'obligation' && !openObligations?.some(r => r.id === o.sourceId)
                return (
                  <li key={o.key} className="px-1 py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 truncate">{o.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>{OBLIGATION_KIND_LABELS[o.kind]}</span>
                        <span>·</span>
                        <span className={o.overdue ? 'text-red-600 font-medium' : ''}>{dateNL(o.dueDate)}</span>
                        {boat && <><span>·</span><span>{boat}</span></>}
                        {o.overdue && (
                          <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">over tijd</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-sm font-semibold tabular-nums text-zinc-900">{eur(o.amountCents)}</span>
                      <div className="flex items-center gap-0.5">
                        <button type="button" onClick={() => markPaid(o)} className="text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 rounded-md px-1.5 py-1">
                          Betaald
                        </button>
                        {o.source === 'obligation' ? (
                          <>
                            <button type="button" onClick={() => editObligation(o)} disabled={paymentPending} aria-label="Bewerken" className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-30">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => cancelObligation(o)} aria-label="Annuleren" className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50">
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <Link href={`/${locale}/admin/finance/loans`} className="text-[11px] text-zinc-400 hover:text-zinc-700 px-1.5 py-1">
                            lening
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {data.obligations.length > 8 && (
            <button type="button" onClick={() => setShowAllObligations(s => !s)} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 self-start">
              {showAllObligations ? 'Toon minder' : `Toon alle ${data.obligations.length}`}
            </button>
          )}
        </section>

        {/* Goals */}
        <section className={`${cardClass} p-4 sm:p-5 flex flex-col gap-3`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-zinc-900">Doelen</h2>
            <Link href={`/${locale}/admin/finance/goals`} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
              Alle doelen →
            </Link>
          </div>
          {topGoals.length === 0 ? (
            <p className="text-sm text-zinc-500">Nog geen actieve doelen.</p>
          ) : (
            <ul className="space-y-3">
              {topGoals.map(g => (
                <li key={g.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-900 truncate">{g.name}</p>
                    <span className="text-xs text-zinc-500 tabular-nums shrink-0">{eur(g.fundedCents)} / {eur(g.targetCents)}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-zinc-100 overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500 transition-[width]" style={{ width: `${Math.min(100, Math.max(0, g.progressPct))}%` }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <span className="text-zinc-500">{pct(g.progressPct)}{g.monthsLeft != null ? ` · nog ${g.monthsLeft} ${g.monthsLeft === 1 ? 'maand' : 'maanden'}` : ''}</span>
                    {g.behindCents > 0 && <span className="text-amber-600 font-medium">{eur(g.behindCents)} achter op schema</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Owner salary */}
        <section className={`${cardClass} p-4 sm:p-5 flex flex-col gap-3`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-zinc-900">Eigenaarssalaris</h2>
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Salaris instellen" className="p-2 -m-2 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
          {salary.monthlyCents <= 0 ? (
            <p className="text-sm text-zinc-500">
              Nog geen salaris ingesteld.{' '}
              <button type="button" onClick={() => setSettingsOpen(true)} className="text-indigo-600 hover:text-indigo-800 font-medium">Instellen</button>
            </p>
          ) : (
            <>
              <p className="text-2xl font-semibold text-zinc-900 tabular-nums">
                {salary.monthsCovered} <span className="text-sm font-normal text-zinc-500">van {salary.targetMonths} maanden gedekt</span>
              </p>
              <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                <div className={`h-full rounded-full transition-[width] ${salaryPct >= 100 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, Math.max(0, salaryPct))}%` }} />
              </div>
              <dl className="text-xs text-zinc-500 grid grid-cols-2 gap-y-1">
                <dt>Gereserveerd</dt><dd className="text-right tabular-nums text-zinc-900">{eur(salary.coverageCents)}</dd>
                <dt>Doel</dt><dd className="text-right tabular-nums text-zinc-900">{eur(salary.targetCents)}</dd>
                <dt>Per maand</dt><dd className="text-right tabular-nums text-zinc-900">{eur(salary.monthlyCents)}</dd>
              </dl>
            </>
          )}
        </section>
      </div>

      {/* Attention */}
      <section className={`${cardClass} p-4 sm:p-5 space-y-2`}>
        <h2 className="text-base font-semibold text-zinc-900">Wat vraagt aandacht?</h2>
        {data.status.reasons.length === 0 ? (
          <p className="text-sm text-zinc-500">Niets — alles ziet er goed uit.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.status.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-zinc-700">
                <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${data.status.level === 'tight' ? 'text-red-500' : 'text-amber-500'}`} />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <WhyDrawer
        open={whyOpen}
        onClose={() => setWhyOpen(false)}
        title={`Waarom: ${whyTitle}`}
        horizon={activeHorizon}
        horizonEnd={data.horizonEnd}
        lines={data.why}
      />

      <ObligationModal
        open={obligationModal.open}
        editing={obligationModal.editing}
        onClose={() => setObligationModal({ open: false, editing: null })}
        onSaved={refreshAll}
      />

      <SettingsModal open={settingsOpen} settings={settings ?? null} onClose={() => setSettingsOpen(false)} onSaved={refreshAll} />
      <ManualCashModal open={cashOpen} settings={settings ?? null} onClose={() => setCashOpen(false)} onSaved={refreshAll} />
    </div>
  )
}
