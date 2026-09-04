'use client'

import { useState } from 'react'
import { Archive, ChevronDown, Loader2, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { AdminPageSkeleton } from '@/components/admin/AdminPageSkeleton'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { FinanceSubnav } from '@/components/admin/finance/cockpit/FinanceSubnav'
import { LoanModal } from '@/components/admin/finance/cockpit/LoanModal'
import { LoanImpactModal } from '@/components/admin/finance/cockpit/LoanImpactModal'
import { StatCard } from '@/components/admin/finance/cockpit/StatCard'
import {
  COCKPIT_API,
  REPAYMENT_TYPE_LABELS,
  type LoanApiRow,
  type LoanDetail,
  type LoanPayload,
} from '@/components/admin/finance/cockpit/api-types'
import { eur, eurCents, dateNL } from '@/components/admin/finance/cockpit/money'

/** The materialised payment schedule of one loan, with a "Betaald" button per open period. */
function LoanSchedule({ loanId, onChanged }: { loanId: string; onChanged: () => void }) {
  const { data, isLoading, error, refresh } = useAdminFetch<LoanDetail>(`${COCKPIT_API}/loans/${loanId}`)
  const { error: actionError, run, saving } = useAdminSave()

  function markPaid(paymentId: string) {
    run(async () => {
      await adminMutate(`${COCKPIT_API}/loans/${loanId}/payments/${paymentId}/mark-paid`, 'POST', {})
      refresh()
      onChanged()
    })
  }

  if (isLoading && !data) return <p className="text-xs text-zinc-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Schema laden…</p>
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!data || data.payments.length === 0) return <p className="text-xs text-zinc-400">Geen betalingen in het schema.</p>

  return (
    <div className="space-y-2">
      <AdminErrorBanner error={actionError} />
      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Datum</th>
              <th className="text-right px-3 py-2 font-medium">Rente</th>
              <th className="text-right px-3 py-2 font-medium">Aflossing</th>
              <th className="text-right px-3 py-2 font-medium">Totaal</th>
              <th className="text-right px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.payments.map(p => (
              <tr key={p.id} className={p.is_paid ? 'text-zinc-400' : 'text-zinc-800'}>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">{dateNL(p.due_date)}</td>
                <td className="px-3 py-2 tabular-nums text-right">{eurCents(p.interest_cents)}</td>
                <td className="px-3 py-2 tabular-nums text-right">{eurCents(p.principal_cents)}</td>
                <td className="px-3 py-2 tabular-nums text-right font-medium">{eurCents(p.total_cents)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {p.is_paid ? (
                    <span className="text-emerald-600">betaald{p.paid_at ? ` ${dateNL(p.paid_at)}` : ''}</span>
                  ) : (
                    <button type="button" disabled={saving} onClick={() => markPaid(p.id)} className="text-emerald-700 font-medium hover:bg-emerald-50 rounded-md px-2 py-1 disabled:opacity-50">
                      Betaald
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function FinanceLoansPage() {
  const { data, isLoading, error, refresh } = useAdminFetch<LoanApiRow[]>(`${COCKPIT_API}/loans`)
  const { error: actionError, run } = useAdminSave()

  const [loanModal, setLoanModal] = useState<{ open: boolean; editing: LoanApiRow | null }>({ open: false, editing: null })
  const [draft, setDraft] = useState<LoanPayload | null>(null)
  const [impactOpen, setImpactOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  function closeLoan(l: LoanApiRow) {
    if (!window.confirm(`"${l.name}" sluiten? Openstaande betalingen verdwijnen uit de berekening.`)) return
    run(async () => {
      await adminMutate(`${COCKPIT_API}/loans/${l.id}`, 'DELETE')
      refresh()
    })
  }

  const loans = data ?? []
  const active = loans.filter(l => l.status === 'active')
  const totalOutstanding = active.reduce((s, l) => s + l.summary.outstandingCents, 0)
  const totalInterest = active.reduce((s, l) => s + l.summary.totalInterestCents, 0)
  const nextPayment = active
    .map(l => l.summary.nextPayment)
    .filter((p): p is NonNullable<LoanApiRow['summary']['nextPayment']> => p != null)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null
  const nextDateTotal = nextPayment
    ? active.reduce((s, l) => s + (l.summary.nextPayment?.due_date === nextPayment.due_date ? l.summary.nextPayment.total_cents : 0), 0)
    : 0

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-6">
      <FinanceSubnav />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Leningen</h1>
          <p className="text-sm text-zinc-500 mt-1">Elke betaling uit het schema telt als verplichting zodra hij in de horizon valt.</p>
        </div>
        <Button size="sm" onClick={() => { setDraft(null); setLoanModal({ open: true, editing: null }) }}>
          <Plus className="w-3.5 h-3.5" /> Lening toevoegen
        </Button>
      </div>

      <AdminErrorBanner error={error ?? actionError} />

      {!data && isLoading ? (
        <AdminPageSkeleton />
      ) : (
        <>
          {active.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard title="Openstaand" value={eur(totalOutstanding)} subtitle={`${active.length} actieve ${active.length === 1 ? 'lening' : 'leningen'}`} />
              <StatCard title="Volgende betaling" value={nextPayment ? eur(nextDateTotal) : '—'} subtitle={nextPayment ? `op ${dateNL(nextPayment.due_date)}` : 'geen open betalingen'} />
              <StatCard title="Totale rente" value={eur(totalInterest)} subtitle="over de hele looptijd" />
            </div>
          )}

          {loans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center">
              <p className="text-sm text-zinc-500">Nog geen leningen.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => { setDraft(null); setLoanModal({ open: true, editing: null }) }}>
                <Plus className="w-3.5 h-3.5" /> Eerste lening toevoegen
              </Button>
            </div>
          ) : (
            <ul className="space-y-4">
              {loans.map(l => {
                const isOpen = expanded === l.id
                const closed = l.status === 'closed'
                return (
                  <li key={l.id} className={`rounded-2xl border bg-white shadow-sm p-4 sm:p-5 space-y-4 ${closed ? 'border-zinc-100 opacity-70' : 'border-zinc-200'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base font-semibold text-zinc-900">{l.name}</h2>
                          {closed && <span className="rounded-full bg-zinc-100 text-zinc-500 px-2 py-0.5 text-[11px] font-semibold">gesloten</span>}
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {l.lender_name} · {eur(l.principal_cents)} · {l.interest_rate_pct}% · {l.duration_years} jaar
                          {l.interest_free_years > 0 ? ` (${l.interest_free_years} rentevrij)` : ''} · {REPAYMENT_TYPE_LABELS[l.repayment_type] ?? l.repayment_type} · start {dateNL(l.start_date)}
                        </p>
                        {l.tranches && l.tranches.length > 0 && (
                          <p className="text-xs text-zinc-400 mt-0.5">
                            {l.tranches.length} tranches: {l.tranches.map(t => `${eur(t.amount_cents)} op ${dateNL(t.date)}`).join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => setLoanModal({ open: true, editing: l })} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-md px-2 py-2">
                          <Pencil className="w-3.5 h-3.5" /> Bewerken
                        </button>
                        {!closed && (
                          <button type="button" onClick={() => closeLoan(l)} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-md px-2 py-2">
                            <Archive className="w-3.5 h-3.5" /> Sluiten
                          </button>
                        )}
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-xl bg-zinc-50 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Openstaand</dt>
                        <dd className="text-sm font-semibold tabular-nums text-zinc-900">{eur(l.summary.outstandingCents)}</dd>
                      </div>
                      <div className="rounded-xl bg-zinc-50 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Volgende betaling</dt>
                        <dd className="text-sm font-semibold tabular-nums text-zinc-900">
                          {l.summary.nextPayment ? eur(l.summary.nextPayment.total_cents) : '—'}
                          {l.summary.nextPayment && <span className="block text-[11px] font-normal text-zinc-500">{dateNL(l.summary.nextPayment.due_date)}</span>}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-zinc-50 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Termijnen</dt>
                        <dd className="text-sm font-semibold tabular-nums text-zinc-900">{l.summary.paidPeriods} / {l.summary.totalPeriods}</dd>
                      </div>
                      <div className="rounded-xl bg-zinc-50 px-3 py-2">
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Totale rente</dt>
                        <dd className="text-sm font-semibold tabular-nums text-zinc-900">{eur(l.summary.totalInterestCents)}</dd>
                      </div>
                    </dl>

                    {l.notes && <p className="text-xs text-zinc-500">{l.notes}</p>}

                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : l.id)}
                      aria-expanded={isOpen}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 min-h-[44px] sm:min-h-0 -my-2 sm:my-0"
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      {isOpen ? 'Verberg schema' : 'Bekijk schema'}
                    </button>

                    {isOpen && <LoanSchedule loanId={l.id} onChanged={refresh} />}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <LoanModal
        open={loanModal.open}
        editing={loanModal.editing}
        initial={draft}
        onClose={() => setLoanModal({ open: false, editing: null })}
        onSaved={refresh}
        onPreview={payload => {
          setDraft(payload)
          setLoanModal({ open: false, editing: null })
          setImpactOpen(true)
        }}
      />

      <LoanImpactModal
        open={impactOpen}
        payload={draft}
        onBack={() => {
          setImpactOpen(false)
          setLoanModal({ open: true, editing: null })
        }}
        onCreated={() => {
          setImpactOpen(false)
          setDraft(null)
          refresh()
        }}
      />
    </div>
  )
}
