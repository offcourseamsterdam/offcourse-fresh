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
  food: { revenueCents: number; bookingCount: number }
  drinks: { revenueCents: number; bookingCount: number }
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
          <div className="bg-white rounded-xl border border-zinc-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <UtensilsCrossed className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-zinc-900">Catering</h2>
              <span className="text-xs text-zinc-400">all time · confirmed bookings</span>
            </div>
            {cateringStats ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  label="Food revenue"
                  value={fmtAdminAmountRounded(cateringStats.food.revenueCents) ?? '€0'}
                  subtitle={`${cateringStats.food.bookingCount} booking${cateringStats.food.bookingCount !== 1 ? 's' : ''}`}
                />
                <KPICard
                  label="Food orders"
                  value={String(cateringStats.food.bookingCount)}
                  subtitle="bookings with food"
                />
                <KPICard
                  label="Drinks revenue"
                  value={fmtAdminAmountRounded(cateringStats.drinks.revenueCents) ?? '€0'}
                  subtitle={`${cateringStats.drinks.bookingCount} booking${cateringStats.drinks.bookingCount !== 1 ? 's' : ''}`}
                />
                <KPICard
                  label="Drinks orders"
                  value={String(cateringStats.drinks.bookingCount)}
                  subtitle="bookings with drinks"
                />
              </div>
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
