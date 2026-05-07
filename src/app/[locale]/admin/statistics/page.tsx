'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2, Activity, UtensilsCrossed } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { KPICard } from '@/components/admin/tracking/KPICard'
import { PeriodSelector, getDateRange, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'
import { TrafficChart } from '@/components/admin/tracking/TrafficChart'
import { ChannelBarChart } from '@/components/admin/tracking/ChannelBarChart'
import { FunnelChart } from '@/components/admin/tracking/FunnelChart'
import { CategoryTabs, type CategoryFilter } from '@/components/admin/tracking/CategoryTabs'
import { fmtAdminAmountRounded } from '@/lib/admin/format'

interface OverviewData {
  kpis: {
    sessions: number
    unique_visitors: number
    anonymous_sessions: number
    bookings: number
    revenue_cents: number
    conversion_rate: number
    prev_sessions: number
    prev_bookings: number
    prev_revenue_cents: number
  }
  trafficByDay: { date: string; sessions: number; bookings: number }[]
  channels: { id: string; name: string; slug: string; color: string | null; sessions: number; bookings: number; revenue_cents: number }[]
}

interface FunnelStep {
  event: string
  label: string
  count: number
  drop_off_rate: number
}

function pctDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

interface CateringRevenueStats {
  totalRevenueCents: number
  foodRevenueCents: number
  drinksRevenueCents: number
  totalBookingCount: number
  cateringBookingCount: number
  avgCateringCents: number
  foodPct: number
  noFoodPct: number
  drinksBreakdown: { name: string; count: number; pct: number }[]
}

export default function StatisticsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [dateRange, setDateRange] = useState(getDateRange('30d'))
  const [category, setCategory] = useState<CategoryFilter>('all')

  const statsParams = new URLSearchParams({ from: dateRange.from, to: dateRange.to, category })
  const { data, isLoading: loadingOverview, refresh: refreshOverview } =
    useAdminFetch<OverviewData>(`/api/admin/tracking/overview?${statsParams}`)
  const { data: funnelData, isLoading: loadingFunnel, refresh: refreshFunnel } =
    useAdminFetch<FunnelStep[]>(`/api/admin/tracking/funnel?${statsParams}`)
  const { data: cateringStats } =
    useAdminFetch<CateringRevenueStats>('/api/admin/catering/revenue-stats')

  const funnel = funnelData ?? []
  const loading = loadingOverview || loadingFunnel

  // Keep refs so the auto-refresh interval always calls the latest refresh functions
  const refreshRef = useRef({ refreshOverview, refreshFunnel })
  refreshRef.current = { refreshOverview, refreshFunnel }

  // Auto-refresh every 30 seconds for live visitor updates
  useEffect(() => {
    const interval = setInterval(() => {
      refreshRef.current.refreshOverview()
      refreshRef.current.refreshFunnel()
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  function handlePeriodChange(key: PeriodKey, from: string, to: string) {
    setPeriod(key)
    setDateRange({ from, to })
  }

  return (
    <div className="p-6 sm:p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-900">Performance</h1>
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Live
              </span>
            </div>
            <p className="text-xs text-zinc-400">Auto-updates every 30s</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CategoryTabs value={category} onChange={setCategory} />
          <PeriodSelector value={period} onChange={handlePeriodChange} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="Sessions"
              value={data.kpis.sessions.toLocaleString()}
              delta={pctDelta(data.kpis.sessions, data.kpis.prev_sessions)}
              subtitle="vs prev period"
            />
            <KPICard
              label="Unique Visitors"
              value={data.kpis.unique_visitors.toLocaleString()}
              subtitle={data.kpis.anonymous_sessions > 0 ? `+${data.kpis.anonymous_sessions} anonymous` : undefined}
            />
            <KPICard
              label="Bookings"
              value={data.kpis.bookings.toLocaleString()}
              delta={pctDelta(data.kpis.bookings, data.kpis.prev_bookings)}
              subtitle="vs prev period"
            />
            <KPICard
              label="Revenue"
              value={`€${(data.kpis.revenue_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`}
              delta={pctDelta(data.kpis.revenue_cents, data.kpis.prev_revenue_cents)}
              subtitle={`${(data.kpis.conversion_rate * 100).toFixed(1)}% CR`}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h2 className="text-sm font-semibold text-zinc-900 mb-4">Traffic Over Time</h2>
              <TrafficChart data={data.trafficByDay} />
            </div>
            <div className="bg-white rounded-xl border border-zinc-200 p-5">
              <h2 className="text-sm font-semibold text-zinc-900 mb-4">Sessions by Channel</h2>
              <ChannelBarChart data={data.channels.map((c) => ({ name: c.name, sessions: c.sessions, color: c.color }))} />
            </div>
          </div>

          {/* Funnel */}
          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <h2 className="text-sm font-semibold text-zinc-900 mb-4">Booking Funnel</h2>
            <FunnelChart steps={funnel} />
          </div>

          {/* Catering */}
          <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-6">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-zinc-900">Catering</h2>
              <span className="text-xs text-zinc-400">all time · confirmed bookings</span>
            </div>

            {cateringStats ? (
              <>
                {/* Revenue row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPICard
                    label="Total catering"
                    value={fmtAdminAmountRounded(cateringStats.totalRevenueCents) ?? '€0'}
                    subtitle={`${cateringStats.cateringBookingCount} bookings`}
                  />
                  <KPICard
                    label="Food revenue"
                    value={fmtAdminAmountRounded(cateringStats.foodRevenueCents) ?? '€0'}
                    subtitle={`${cateringStats.foodPct}% of bookings`}
                  />
                  <KPICard
                    label="Drinks revenue"
                    value={fmtAdminAmountRounded(cateringStats.drinksRevenueCents) ?? '€0'}
                  />
                  <KPICard
                    label="Avg per catering booking"
                    value={fmtAdminAmountRounded(cateringStats.avgCateringCents) ?? '€0'}
                    subtitle="bookings that ordered"
                  />
                </div>

                {/* Breakdown row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-zinc-100">

                  {/* Drinks mix */}
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-3">
                      Drinks selection
                    </p>
                    <div className="space-y-2.5">
                      {cateringStats.drinksBreakdown.map(d => (
                        <div key={d.name} className="flex items-center gap-3">
                          <span className={`text-sm flex-1 truncate ${d.name === 'No drinks extra' ? 'text-zinc-400' : 'text-zinc-700'}`}>
                            {d.name}
                          </span>
                          <div className="w-28 bg-zinc-100 rounded-full h-1.5 overflow-hidden flex-shrink-0">
                            <div
                              className={`h-1.5 rounded-full ${d.name === 'No drinks extra' ? 'bg-zinc-300' : 'bg-blue-400'}`}
                              style={{ width: `${Math.min(d.pct, 100)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-medium tabular-nums w-10 text-right flex-shrink-0 ${d.name === 'No drinks extra' ? 'text-zinc-400' : 'text-zinc-900'}`}>
                            {d.pct}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Food snack rate */}
                  <div>
                    <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-3">
                      Food
                    </p>
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-zinc-700 flex-1">Booked a snack</span>
                        <div className="w-28 bg-zinc-100 rounded-full h-1.5 overflow-hidden flex-shrink-0">
                          <div className="bg-amber-400 h-1.5 rounded-full" style={{ width: `${Math.min(cateringStats.foodPct, 100)}%` }} />
                        </div>
                        <span className="text-xs font-medium text-zinc-900 tabular-nums w-10 text-right flex-shrink-0">
                          {cateringStats.foodPct}%
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-zinc-400 flex-1">No food</span>
                        <div className="w-28 bg-zinc-100 rounded-full h-1.5 overflow-hidden flex-shrink-0">
                          <div className="bg-zinc-200 h-1.5 rounded-full" style={{ width: `${Math.min(cateringStats.noFoodPct, 100)}%` }} />
                        </div>
                        <span className="text-xs font-medium text-zinc-400 tabular-nums w-10 text-right flex-shrink-0">
                          {cateringStats.noFoodPct}%
                        </span>
                      </div>
                    </div>
                  </div>

                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-20 text-sm text-zinc-400">
          No tracking data yet. Data will appear as visitors browse the site.
        </div>
      )}
    </div>
  )
}
