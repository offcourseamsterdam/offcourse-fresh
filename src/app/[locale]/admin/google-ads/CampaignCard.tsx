'use client'

import { useState } from 'react'
import { Pause, Play, Pencil, Check, X, Ban, Link2 } from 'lucide-react'
import type { DashboardCampaign, Verdict } from '@/lib/google-ads/dashboard'
import type { LinkedCampaign } from '@/lib/google-ads/listings'
import { NegativesPanel } from './NegativesPanel'

const eur = (n: number) => `€${Math.round(n).toLocaleString('en-US')}`

const VERDICT_STYLES: Record<Verdict['tone'], string> = {
  good: 'bg-emerald-100 text-emerald-700',
  bad: 'bg-red-100 text-red-700',
  learn: 'bg-amber-100 text-amber-700',
  neutral: 'bg-zinc-100 text-zinc-500',
}

async function postAction(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error ?? 'Action failed')
}

export function CampaignCard({
  campaign,
  marketingCampaigns,
  demo,
  onChanged,
}: {
  campaign: DashboardCampaign
  marketingCampaigns: LinkedCampaign[]
  demo: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState(String(campaign.dailyBudgetEuros))
  const [showNegatives, setShowNegatives] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const enabled = campaign.status === 'ENABLED'
  const profitColor =
    campaign.profitEuros > 0 ? 'text-emerald-600' : campaign.profitEuros < 0 ? 'text-red-500' : 'text-zinc-500'

  async function run(fn: () => Promise<void>) {
    if (demo) {
      setErr('Demo mode — actions are disabled.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  function toggleStatus() {
    const next = enabled ? 'pause' : 'enable'
    if (next === 'enable' && !confirm(`Enable “${campaign.name}”? It will start spending up to €${campaign.dailyBudgetEuros}/day.`)) return
    run(() => postAction('/api/admin/google-ads/campaign', { campaignId: campaign.id, action: next }))
  }

  function saveBudget() {
    const amount = Number(budgetInput)
    if (!(amount > 0)) {
      setErr('Budget must be a positive number.')
      return
    }
    if (amount > campaign.dailyBudgetEuros && !confirm(`Raise daily budget to €${amount}? This can increase spend.`)) return
    run(() => postAction('/api/admin/google-ads/campaign', { campaignId: campaign.id, action: 'budget', eur: amount })).then(
      () => setEditingBudget(false),
    )
  }

  function linkCampaign(marketingCampaignId: string) {
    run(() =>
      postAction('/api/admin/google-ads/link', {
        campaignId: campaign.id,
        marketingCampaignId: marketingCampaignId || null,
      }),
    )
  }

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
      {/* Top row: name + verdict + status toggle */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-zinc-900 truncate">{campaign.name}</h3>
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${VERDICT_STYLES[campaign.verdict.tone]}`}>
              {campaign.verdict.label}
            </span>
          </div>
          {campaign.marketing && (
            <p className="text-xs text-zinc-400 flex items-center gap-1 mt-0.5">
              <Link2 className="w-3 h-3" /> {campaign.marketing.name}
            </p>
          )}
        </div>
        <button
          onClick={toggleStatus}
          disabled={busy}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-lg text-xs font-medium border transition disabled:opacity-50 ${
            enabled ? 'border-zinc-200 text-zinc-600 hover:bg-zinc-50' : 'border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
          }`}
        >
          {enabled ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Enable</>}
        </button>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Stat label="Spend" value={eur(campaign.costEuros)} />
        <Stat label="CPC" value={campaign.avgCpcEuros > 0 ? `€${campaign.avgCpcEuros.toFixed(2)}` : '—'} />
        <Stat label="Bookings" value={String(Math.round(campaign.bookings))} />
        <Stat label="Profit" value={eur(campaign.profitEuros)} valueClass={profitColor} />
        <Stat label="ROAS" value={campaign.roas != null ? `${campaign.roas.toFixed(1)}×` : '—'} />
      </div>

      {/* Footer: budget + listing + negatives */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 border-t border-zinc-100">
        {/* Budget */}
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="text-zinc-400">Budget</span>
          {editingBudget ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-zinc-400">€</span>
              <input
                type="number"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                className="w-16 px-1.5 py-1 border border-zinc-300 rounded text-zinc-900 tabular-nums"
                autoFocus
              />
              <button onClick={saveBudget} disabled={busy} className="text-emerald-600 p-1" aria-label="Save budget"><Check className="w-4 h-4" /></button>
              <button onClick={() => { setEditingBudget(false); setBudgetInput(String(campaign.dailyBudgetEuros)) }} className="text-zinc-400 p-1" aria-label="Cancel"><X className="w-4 h-4" /></button>
            </span>
          ) : (
            <button onClick={() => setEditingBudget(true)} className="inline-flex items-center gap-1 font-medium text-zinc-700 hover:text-zinc-900">
              €{campaign.dailyBudgetEuros}/day <Pencil className="w-3 h-3 text-zinc-400" />
            </button>
          )}
        </div>

        {/* Marketing campaign link (the editable connection) */}
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="text-zinc-400">Campaign</span>
          <select
            value={campaign.marketing?.id ?? ''}
            onChange={e => linkCampaign(e.target.value)}
            disabled={busy}
            className="max-w-[200px] text-xs border border-zinc-200 rounded px-1.5 py-1 text-zinc-700 bg-white"
          >
            <option value="">— none —</option>
            {marketingCampaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {/* Listing — read-only, derived from the campaign above */}
        <span className="flex items-center gap-1.5 text-xs text-zinc-500" title="Determined by the connected campaign — change the campaign to change this.">
          <span className="text-zinc-400">Listing</span>
          <span className="font-medium text-zinc-700">{campaign.listing?.title ?? '— set by campaign —'}</span>
        </span>

        {/* Negatives toggle */}
        <button
          onClick={() => setShowNegatives(s => !s)}
          className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900"
        >
          <Ban className="w-3.5 h-3.5" /> Blocked searches
        </button>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      {showNegatives && (
        <NegativesPanel campaignId={campaign.id} demo={demo} onBlocked={onChanged} />
      )}
    </div>
  )
}

function Stat({ label, value, valueClass = 'text-zinc-900' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-zinc-50 rounded-lg px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  )
}
