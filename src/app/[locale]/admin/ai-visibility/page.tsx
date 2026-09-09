'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { getDateRange, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'
import type { AiReferralsData, AvailabilitySyncStatus } from '@/components/admin/ai-visibility/types'
import { AiVisibilityHeader } from '@/components/admin/ai-visibility/AiVisibilityHeader'
import { AvailabilitySyncCard } from '@/components/admin/ai-visibility/AvailabilitySyncCard'
import { AiMetricsCards } from '@/components/admin/ai-visibility/AiMetricsCards'
import { AiEnginesTable } from '@/components/admin/ai-visibility/AiEnginesTable'
import { RecentAiRecommendationsFeed } from '@/components/admin/ai-visibility/RecentAiRecommendationsFeed'
import { GeoReadinessOverview } from '@/components/admin/ai-visibility/GeoReadinessOverview'

export default function AiVisibilityPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [dateRange, setDateRange] = useState(getDateRange('30d'))
  const [isSyncing, setIsSyncing] = useState(false)
  const [demoMode, setDemoMode] = useState(false)

  const aiParams = new URLSearchParams({
    from: dateRange.from,
    to: dateRange.to,
    ...(demoMode ? { demo: '1' } : {}),
  })

  const {
    data: aiData,
    isLoading: aiLoading,
    refresh: refreshAiData,
  } = useAdminFetch<AiReferralsData>(`/api/admin/tracking/ai-referrals?${aiParams}`)

  const {
    data: syncStatus,
    isLoading: syncLoading,
    refresh: refreshSyncStatus,
  } = useAdminFetch<AvailabilitySyncStatus>('/api/admin/availability-sync')

  async function handleManualSync() {
    setIsSyncing(true)
    const toastId = toast.loading('FareHarbor beschikbaarheid synchroniseren...')

    try {
      const res = await fetch('/api/admin/availability-sync', { method: 'POST' })
      const json = await res.json()

      if (json.ok) {
        toast.success(
          `Succesvol gesynchroniseerd! ${json.data?.syncedListingsCount ?? 0} listings bijgewerkt.`,
          { id: toastId },
        )
        refreshSyncStatus()
        refreshAiData()
      } else {
        toast.error(`Synchronisatiefout: ${json.error ?? 'Onbekende fout'}`, { id: toastId })
      }
    } catch {
      toast.error('Netwerkfout bij synchroniseren', { id: toastId })
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="space-y-6 pb-12">
      <AiVisibilityHeader
        isDemo={Boolean(aiData?.demo)}
        demoMode={demoMode}
        onToggleDemo={() => setDemoMode(!demoMode)}
        period={period}
        onPeriodChange={(p, from, to) => {
          setPeriod(p)
          setDateRange({ from, to })
        }}
        isSyncing={isSyncing}
        onManualSync={handleManualSync}
      />

      <AvailabilitySyncCard syncStatus={syncStatus} isLoading={syncLoading} />

      <AiMetricsCards data={aiData} isLoading={aiLoading} />

      <AiEnginesTable
        engines={aiData?.engines ?? []}
        isLoading={aiLoading}
        onEnableDemo={() => setDemoMode(true)}
      />

      <RecentAiRecommendationsFeed
        recentSessions={aiData?.recentAvailabilitySessions ?? []}
      />

      <GeoReadinessOverview />
    </div>
  )
}
