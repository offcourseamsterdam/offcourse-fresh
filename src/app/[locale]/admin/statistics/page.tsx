'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Activity } from 'lucide-react'
import { KPICard } from '@/components/admin/tracking/KPICard'
import { PeriodSelector, getDateRange, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'
import { TrafficChart } from '@/components/admin/tracking/TrafficChart'
import { ChannelBarChart } from '@/components/admin/tracking/ChannelBarChart'
import { FunnelChart } from '@/components/admin/tracking/FunnelChart'

interface OverviewData {
  kpis: {
    sessions: number
    unique_visitors: number
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

export default function StatisticsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [dateRange, setDateRange] = useState(getDateRange('30d'))
  const [data, setData] = useState<OverviewData | null>(null)
  const [funnel, setFunnel] = useState<FunnelStep[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async (from: string, to: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const [overviewRes, funnelRes] = await Promise.all([
        fetch(`/api/admin/tracking/overview?${params}`),
        fetch(`/api/admin/tracking/funnel?${params}`),
      ])
      const overviewJson = await overviewRes.json()
      const funnelJson = await funnelRes.json()

      if (overviewJson.ok) setData(overviewJson.data)
      if (funnelJson.ok) setFunnel(funnelJson.data)
    } catch (err) {
      console.error('Failed to load tracking data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(dateRange.from, dateRange.to)
  }, [dateRange, fetchData])

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
            <h1 className="text-xl font-bold text-zinc-900">Performance</h1>
            <p className="text-xs text-zinc-400">Traffic, conversions & funnel analytics</p>
          </div>
        </div>
        <PeriodSelector value={period} onChange={handlePeriodChange} />
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
            />
            <KPICard
              label="Bookings"
              value={data.kpis.bookings.toLocaleString()}
              delta={pctDelta(data.kpis.bookings, data.kpis.prev_bookings)}
              subtitle="vs prev period"
            />
            <KPICard
              label="Revenue"
              value={`€${(data.kpis.revenue_cents / 100).toLocaleString('nl-NL', { minimumFractionDigits: 0 })}`}
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
        </>
      ) : (
        <div className="text-center py-20 text-sm text-zinc-400">
          No tracking data yet. Data will appear as visitors browse the site.
        </div>
      )}
    </div>
  )
}
