'use client'

import { useState, useEffect } from 'react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { Loader2, Megaphone } from 'lucide-react'
import { PeriodSelector, getDateRange, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'
import { CampaignModal } from '@/components/admin/tracking/CampaignModal'
import { CategoryTabs, type CategoryFilter } from '@/components/admin/tracking/CategoryTabs'
import { ChannelSection, type ChannelWithMetrics, type Campaign, type CampaignMetrics, type CampaignBooking } from './ChannelSection'

export default function CampaignsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [dateRange, setDateRange] = useState(getDateRange('30d'))
  const [category, setCategory] = useState<CategoryFilter>('all')

  const campaignParams = new URLSearchParams({ from: dateRange.from, to: dateRange.to, category })
  const { data: overviewData, isLoading: loading, refresh: refreshChannels } =
    useAdminFetch<{ channels: ChannelWithMetrics[] }>(`/api/admin/tracking/overview?${campaignParams}`)
  const channels = overviewData?.channels ?? []

  const [expandedChannel, setExpandedChannel] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<Record<string, Campaign[]>>({})
  const [loadingCampaigns, setLoadingCampaigns] = useState<string | null>(null)
  const [showCampaignModal, setShowCampaignModal] = useState(false)
  const [campaignModalChannelId, setCampaignModalChannelId] = useState<string | undefined>()
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)

  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null)
  const [campaignMetrics, setCampaignMetrics] = useState<Record<string, CampaignMetrics>>({})
  const [campaignBookings, setCampaignBookings] = useState<Record<string, CampaignBooking[]>>({})
  const [loadingCampaignDetail, setLoadingCampaignDetail] = useState<string | null>(null)

  const [partnerNames, setPartnerNames] = useState<Map<string, string>>(new Map())
  const [listingNames, setListingNames] = useState<Map<string, string>>(new Map())
  const [activePartner, setActivePartner] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/partners').then(r => r.json()),
      fetch('/api/admin/cruise-listings').then(r => r.json()),
    ]).then(([pJson, lJson]) => {
      if (pJson.ok) {
        const map = new Map<string, string>()
        for (const p of pJson.data?.partners ?? pJson.data ?? []) map.set(p.id, p.name)
        setPartnerNames(map)
      }
      if (lJson.ok) {
        const map = new Map<string, string>()
        for (const l of lJson.data?.listings ?? lJson.data ?? []) map.set(l.id, l.title)
        setListingNames(map)
      }
    }).catch(() => {})
  }, [])

  async function toggleChannel(channelId: string) {
    if (expandedChannel === channelId) {
      setExpandedChannel(null)
      setActivePartner(null)
      return
    }
    setExpandedChannel(channelId)
    setActivePartner(null)

    if (!campaigns[channelId]) {
      setLoadingCampaigns(channelId)
      try {
        const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
        const res = await fetch(`/api/admin/tracking/channels/${channelId}/campaigns?${params}`)
        const json = await res.json()
        if (json.ok) setCampaigns((prev) => ({ ...prev, [channelId]: json.data }))
      } catch (err) {
        console.error('Failed to load campaigns:', err)
      } finally {
        setLoadingCampaigns(null)
      }
    }
  }

  function handlePeriodChange(key: PeriodKey, from: string, to: string) {
    setPeriod(key)
    setDateRange({ from, to })
    setCampaigns({})
    setCampaignMetrics({})
    setCampaignBookings({})
    setExpandedChannel(null)
    setExpandedCampaign(null)
  }

  async function toggleCampaign(campaignId: string) {
    if (expandedCampaign === campaignId) {
      setExpandedCampaign(null)
      return
    }
    setExpandedCampaign(campaignId)
    if (campaignMetrics[campaignId] && campaignBookings[campaignId]) return

    setLoadingCampaignDetail(campaignId)
    try {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
      const [metricsRes, bookingsRes] = await Promise.all([
        fetch(`/api/admin/tracking/campaigns/${campaignId}/metrics?${params}`),
        fetch(`/api/admin/tracking/campaigns/${campaignId}/bookings?${params}`),
      ])
      const [metricsJson, bookingsJson] = await Promise.all([metricsRes.json(), bookingsRes.json()])
      if (metricsJson.ok) setCampaignMetrics((prev) => ({ ...prev, [campaignId]: metricsJson.data }))
      if (bookingsJson.ok) setCampaignBookings((prev) => ({ ...prev, [campaignId]: bookingsJson.data }))
    } catch (err) {
      console.error('Failed to load campaign detail:', err)
    } finally {
      setLoadingCampaignDetail(null)
    }
  }

  async function deactivateCampaign(campaignId: string, channelId: string) {
    if (!confirm('Deactivate this campaign?')) return
    await fetch(`/api/admin/tracking/campaigns/${campaignId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    })
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
    const res = await fetch(`/api/admin/tracking/channels/${channelId}/campaigns?${params}`)
    const json = await res.json()
    if (json.ok) setCampaigns((prev) => ({ ...prev, [channelId]: json.data }))
  }

  function isPartnersChannel(channelId: string) {
    return channels.find(c => c.id === channelId)?.slug === 'partners'
  }

  return (
    <div className="p-6 sm:p-8 max-w-7xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Campaigns</h1>
            <p className="text-xs text-zinc-400">Channels, campaigns & tracking links</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CategoryTabs value={category} onChange={(cat) => { setCategory(cat); setCampaigns({}); setExpandedChannel(null) }} />
          <PeriodSelector value={period} onChange={handlePeriodChange} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      ) : channels.length === 0 ? (
        <div className="text-center py-20 text-sm text-zinc-400">
          No channels configured yet.
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => (
            <ChannelSection
              key={ch.id}
              channel={ch}
              isExpanded={expandedChannel === ch.id}
              onToggle={() => toggleChannel(ch.id)}
              campaigns={campaigns[ch.id] ?? []}
              loadingCampaigns={loadingCampaigns === ch.id}
              isPartners={isPartnersChannel(ch.id)}
              activePartner={activePartner}
              onSelectPartner={setActivePartner}
              expandedCampaign={expandedCampaign}
              onToggleCampaign={toggleCampaign}
              campaignMetrics={campaignMetrics}
              campaignBookings={campaignBookings}
              loadingCampaignDetail={loadingCampaignDetail}
              partnerNames={partnerNames}
              listingNames={listingNames}
              onEditCampaign={(campaign) => { setEditingCampaign(campaign); setShowCampaignModal(true) }}
              onDeactivateCampaign={deactivateCampaign}
              onAddCampaign={(channelId) => { setCampaignModalChannelId(channelId); setShowCampaignModal(true) }}
            />
          ))}
        </div>
      )}

      <CampaignModal
        open={showCampaignModal}
        onClose={() => { setShowCampaignModal(false); setEditingCampaign(null) }}
        onSaved={() => {
          setCampaigns({})
          setCampaignMetrics({})
          setCampaignBookings({})
          refreshChannels()
          if (expandedChannel) {
            const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
            fetch(`/api/admin/tracking/channels/${expandedChannel}/campaigns?${params}`)
              .then(r => r.json())
              .then(json => { if (json.ok) setCampaigns(prev => ({ ...prev, [expandedChannel]: json.data })) })
              .catch(() => {})
          }
          setEditingCampaign(null)
        }}
        defaultChannelId={campaignModalChannelId}
        editing={editingCampaign}
      />
    </div>
  )
}
