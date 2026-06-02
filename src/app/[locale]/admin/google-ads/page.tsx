'use client'

import { useState } from 'react'
import { Loader2, RefreshCw, TrendingUp } from 'lucide-react'
import { KPICard } from '@/components/admin/tracking/KPICard'
import { FunnelChart } from '@/components/admin/tracking/FunnelChart'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { DashboardCampaign, HeroStats, FunnelStep } from '@/lib/google-ads/dashboard'
import type { LinkedCampaign } from '@/lib/google-ads/listings'
import { CampaignCard } from './CampaignCard'

interface DashboardData {
  days: number
  hero: HeroStats
  funnel: FunnelStep[]
  campaigns: DashboardCampaign[]
  marketingCampaigns: LinkedCampaign[]
  demo?: boolean
  notConfigured?: boolean
  error?: string
  perfError?: string
}

const DAY_OPTIONS = [7, 30, 90]
// Local helper — must NOT be exported: Next.js only allows specific exports from a page file.
const eur = (n: number) => `€${Math.round(n).toLocaleString('en-US')}`

export default function GoogleAdsPage() {
  const [days, setDays] = useState(30)
  // Dev-only demo data (?demo=1). Computed at render — no effect/state needed, and
  // it only affects the (client-side) SWR fetch key, so there's no hydration risk.
  const demo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1'

  const url = `/api/admin/google-ads?days=${days}${demo ? '&demo=1' : ''}`
  const { data, isLoading, error, refresh } = useAdminFetch<DashboardData>(url)

  const hero = data?.hero
  const campaigns = data?.campaigns ?? []
  const marketingCampaigns = data?.marketingCampaigns ?? []

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-indigo-600" />
            Google Ads
            {data?.demo && (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                Demo data
              </span>
            )}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">Your campaigns, in plain euros.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
            {DAY_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  days === d ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Not configured / error banner */}
      {data?.notConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Google Ads isn’t connected yet (missing API credentials). Once it’s set up, your campaigns appear here.
        </div>
      )}

      {/* Hero — the three cards you asked for */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPICard
          label="Profit (net − ad spend)"
          value={hero ? eur(hero.profitEuros) : '—'}
          subtitle={hero ? `${eur(hero.revenueEuros)} earned − ${eur(hero.spendEuros)} spent` : `last ${days} days`}
        />
        <KPICard label="Bookings from ads" value={hero ? String(Math.round(hero.bookings)) : '—'} subtitle={`last ${days} days`} />
        <KPICard
          label="ROAS"
          value={hero?.roas != null ? `${hero.roas.toFixed(1)}×` : '—'}
          subtitle="return on ad spend"
        />
      </div>

      {/* Funnel */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-1">Where people drop off</h2>
        <p className="text-xs text-zinc-500 mb-4">Saw your ad → clicked → booked. Big drops tell you where to look.</p>
        {data ? <FunnelChart steps={data.funnel} /> : <Skeleton />}
      </div>

      {/* Campaigns */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Campaigns</h2>
        {isLoading && !data && <Skeleton />}
        {error && <p className="text-sm text-red-500">Couldn’t load: {error}</p>}
        {data && campaigns.length === 0 && !data.notConfigured && (
          <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
            No campaigns yet. Create one by talking to Claude — it’ll dry-run first, then go live (paused) on your OK.
          </div>
        )}
        {campaigns.map(c => (
          <CampaignCard key={c.id} campaign={c} marketingCampaigns={marketingCampaigns} demo={!!demo} onChanged={refresh} />
        ))}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex items-center justify-center h-24 text-zinc-300">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  )
}
