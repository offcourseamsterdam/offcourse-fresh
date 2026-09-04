'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Loader2, X } from 'lucide-react'
import { adminMutate } from '@/hooks/useAdminSave'
import { HORIZON_LABELS, type Horizon } from '@/lib/finance/cockpit/types'
import { COCKPIT_API, type LoanImpactResult, type LoanPayload } from './api-types'
import { eur, eurCents, dateNL } from './money'

interface LoanImpactModalProps {
  open: boolean
  payload: LoanPayload | null
  horizon?: Horizon
  onBack: () => void
  /** Called after the loan was actually created. */
  onCreated: () => void
}

function sumObligations(cents: Array<{ amountCents: number }>): number {
  return cents.reduce((s, o) => s + o.amountCents, 0)
}

/**
 * "Wat betekent dit voor je financiële ruimte?" — shown before a new loan is
 * saved. Runs the same engine twice (with and without the loan) via
 * POST loans/impact; nothing is stored until "Toevoegen".
 */
export function LoanImpactModal({ open, payload, horizon, onBack, onCreated }: LoanImpactModalProps) {
  const [proceedsReceived, setProceedsReceived] = useState(true)
  const [impact, setImpact] = useState<LoanImpactResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !payload) return
    let cancelled = false
    setLoading(true)
    setError(null)
    adminMutate<LoanImpactResult>(`${COCKPIT_API}/loans/impact`, 'POST', {
      ...payload,
      proceeds_received: proceedsReceived,
      ...(horizon ? { horizon } : {}),
    })
      .then(res => { if (!cancelled) setImpact(res) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Impact kon niet berekend worden') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, payload, proceedsReceived, horizon])

  useEffect(() => {
    if (!open) {
      setImpact(null)
      setError(null)
      setProceedsReceived(true)
    }
  }, [open])

  if (!open || !payload) return null

  async function handleConfirm() {
    if (!payload) return
    setSaving(true)
    setError(null)
    try {
      await adminMutate(`${COCKPIT_API}/loans`, 'POST', payload)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan mislukt')
    } finally {
      setSaving(false)
    }
  }

  const before = impact?.before
  const after = impact?.after
  const warn = impact?.belowSafetyMargin ?? false
  const effectiveHorizon = after?.horizon ?? horizon

  const rows: Array<{ label: string; before: number | undefined; after: number | undefined; tone?: 'green' }> = [
    { label: 'Cash', before: before?.cash.clearedCents, after: after?.cash.clearedCents },
    { label: `Verplichtingen (${effectiveHorizon ? HORIZON_LABELS[effectiveHorizon] : 'horizon'})`, before: before ? sumObligations(before.obligations) : undefined, after: after ? sumObligations(after.obligations) : undefined },
    { label: 'Financiële ruimte vóór veiligheidsmarge', before: before?.financialSpaceCents, after: after?.financialSpaceCents },
    { label: 'Beschikbaar voor groei', before: before?.availableForGrowthCents, after: after?.availableForGrowthCents, tone: 'green' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onBack} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-t-2xl sm:rounded-2xl border border-zinc-200 shadow-xl w-full max-w-lg animate-modal-in max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Wat betekent dit voor je financiële ruimte?</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{payload.name} · {eur(payload.principal_cents)} · {payload.interest_rate_pct}% · {payload.duration_years} jaar</p>
          </div>
          <button type="button" onClick={onBack} aria-label="Sluiten" className="text-zinc-400 hover:text-zinc-600 p-2 -m-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4 text-sm">
          {/* API semantics: proceeds_received=true → the principal is added to cleared cash in the "after" scenario. */}
          <label className="flex items-start gap-2 text-xs text-zinc-600 cursor-pointer">
            <input type="checkbox" checked={proceedsReceived} onChange={e => setProceedsReceived(e.target.checked)} className="mt-0.5" />
            <span>Het geleende bedrag komt erbij op de rekening. Vink uit als het al in het huidige saldo zit.</span>
          </label>

          {loading && (
            <div className="flex items-center gap-2 text-zinc-500 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Impact berekenen…
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {impact && !loading && (
            <>
              <div className="rounded-xl border border-zinc-200 overflow-hidden">
                <div className="grid grid-cols-[1.4fr_1fr_auto_1fr] gap-x-2 px-3 py-2 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                  <span /> <span className="text-right">Nu</span> <span /> <span className="text-right">Met lening</span>
                </div>
                {rows.map(r => {
                  const worse = r.before != null && r.after != null && r.after < r.before
                  return (
                    <div key={r.label} className="grid grid-cols-[1.4fr_1fr_auto_1fr] gap-x-2 items-center px-3 py-2 border-t border-zinc-100">
                      <span className={`text-zinc-700 ${r.tone === 'green' ? 'font-medium' : ''}`}>{r.label}</span>
                      <span className="text-right tabular-nums text-zinc-500">{eur(r.before)}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-zinc-300" />
                      <span className={`text-right tabular-nums font-semibold ${r.tone === 'green' ? (worse ? 'text-amber-600' : 'text-emerald-600') : worse ? 'text-red-600' : 'text-zinc-900'}`}>
                        {eur(r.after)}
                      </span>
                    </div>
                  )
                })}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <dt className="text-zinc-500">Extra verplichtingen in horizon</dt>
                <dd className="text-right tabular-nums text-zinc-900">{eur(impact.obligationsAddedInHorizonCents)}</dd>
                <dt className="text-zinc-500">Totale rente over de looptijd</dt>
                <dd className="text-right tabular-nums text-zinc-900">{eur(impact.totalInterestCents)}</dd>
                <dt className="text-zinc-500">Laatste betaling</dt>
                <dd className="text-right tabular-nums text-zinc-900">{dateNL(impact.endDate)}</dd>
              </dl>

              {impact.schedulePreview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-700 mb-1.5">Eerste betalingen</p>
                  <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                    {impact.schedulePreview.slice(0, 4).map(p => (
                      <li key={p.index} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <span className="text-zinc-600 tabular-nums">{dateNL(p.dueDate)}</span>
                        <span className="text-zinc-400 hidden sm:inline">rente {eurCents(p.interestCents)} · aflossing {eurCents(p.principalCents)}</span>
                        <span className="tabular-nums font-medium text-zinc-900">{eurCents(p.totalCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {warn && (
                <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Na toevoeging van deze lening ligt je financiële ruimte vóór veiligheidsmarge onder je gewenste veiligheidsmarge.</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-100 shrink-0">
          <button type="button" onClick={onBack} className="min-h-[44px] sm:min-h-0 px-3 py-2 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 transition-colors">
            Terug
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || loading || !impact}
            className={`min-h-[44px] sm:min-h-0 px-4 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50 transition-colors ${warn ? 'bg-amber-600 hover:bg-amber-700' : 'bg-zinc-900 hover:bg-zinc-800'}`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : warn ? 'Toch toevoegen' : 'Toevoegen'}
          </button>
        </div>
      </div>
    </div>
  )
}
