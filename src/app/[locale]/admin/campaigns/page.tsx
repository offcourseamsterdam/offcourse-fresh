'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Megaphone, ChevronDown, ChevronUp, Plus, ExternalLink } from 'lucide-react'
import { PeriodSelector, getDateRange, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'
import { CampaignModal } from '@/components/admin/tracking/CampaignModal'
import { CategoryTabs, type CategoryFilter } from '@/components/admin/tracking/CategoryTabs'

interface Channel {
  id: string
  name: string
  slug: string
  color: string | null
  icon: string | null
  is_active: boolean
}

interface ChannelWithMetrics extends Channel {
  sessions: number
  bookings: number
  revenue_cents: number
  conversion_rate: number
}

interface Campaign {
  id: string
  name: string
  slug: string
  category: string
  is_active: boolean | null
  sessions?: number
  bookings?: number
  revenue_cents?: number
  conversion_rate?: number
}

export default function CampaignsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [dateRange, setDateRange] = useState(getDateRange('30d'))
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [channels, setChannels] = useState<ChannelWithMetrics[]>([])
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<Record<string, Campaign[]>>({})
  const [loading, setLoading] = useState(true)
  const [loadingCampaigns, setLoadingCampaigns] = useState<string | null>(null)
  const [showCampaignModal, setShowCampaignModal] = useState(false)
  const [campaignModalChannelId, setCampaignModalChannelId] = useState<string | undefined>()

  const fetchChannels = useCallback(async (from: string, to: string, cat: CategoryFilter = 'all') => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from, to, category: cat })
      const res = await fetch(`/api/admin/tracking/overview?${params}`)
      const json = await res.json()
      if (json.ok) {
        setChannels(json.data.channels ?? [])
      }
    } catch (err) {
      console.error('Failed to load channels:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchChannels(dateRange.from, dateRange.to, category)
  }, [dateRange, category, fetchChannels])

  async function toggleChannel(channelId: string) {
    if (expandedChannel === channelId) {
      setExpandedChannel(null)
      return
    }
    setExpandedChannel(channelId)

    if (!campaigns[channelId]) {
      setLoadingCampaigns(channelId)
      try {
        const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
        const res = await fetch(`/api/admin/tracking/channels/${channelId}/campaigns?${params}`)
        const json = await res.json()
        if (json.ok) {
          setCampaigns((prev) => ({ ...prev, [channelId]: json.data }))
        }
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
    setCampaigns({}) // Reset cached campaigns on period change
    setExpandedChannel(null)
  }

  return (
    <div className="p-6 sm:p-8 max-w-7xl space-y-6">
      {/* Header */}
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
          {channels.map((ch) => {
            const isExpanded = expandedChannel === ch.id
            return (
              <div key={ch.id} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                {/* Channel header row */}
                <button
                  onClick={() => toggleChannel(ch.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-zinc-50 transition-colors"
                >
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: ch.color ?? '#71717a' }} />
                  <span className="text-sm font-semibold text-zinc-900 flex-1 text-left">{ch.name}</span>
                  <div className="hidden sm:flex items-center gap-6 text-xs tabular-nums">
                    <span className="text-zinc-500">{ch.sessions?.toLocaleString() ?? 0} <span className="text-zinc-300">sessions</span></span>
                    <span className="text-zinc-500">{ch.bookings?.toLocaleString() ?? 0} <span className="text-zinc-300">bookings</span></span>
                    <span className="text-zinc-500">€{((ch.revenue_cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })} <span className="text-zinc-300">revenue</span></span>
                    <span className="font-medium text-zinc-700">{((ch.conversion_rate ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  )}
                </button>

                {/* Expanded: campaigns table */}
                {isExpanded && (
                  <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-4">
                    {loadingCampaigns === ch.id ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                      </div>
                    ) : (campaigns[ch.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-zinc-400 py-4 text-center">No campaigns in this channel yet.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-zinc-400 uppercase tracking-wider">
                            <th className="text-left py-2 font-medium">Campaign</th>
                            <th className="text-right py-2 font-medium hidden sm:table-cell">Sessions</th>
                            <th className="text-right py-2 font-medium hidden sm:table-cell">Bookings</th>
                            <th className="text-right py-2 font-medium hidden sm:table-cell">Revenue</th>
                            <th className="text-right py-2 font-medium">CR%</th>
                            <th className="text-right py-2 font-medium w-8"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {campaigns[ch.id].map((c) => (
                            <tr key={c.id} className="group">
                              <td className="py-2.5">
                                <span className="font-medium text-zinc-700">{c.name}</span>
                                <span className="text-zinc-300 ml-1.5">/{c.slug}</span>
                              </td>
                              <td className="text-right py-2.5 tabular-nums text-zinc-500 hidden sm:table-cell">{c.sessions?.toLocaleString() ?? '—'}</td>
                              <td className="text-right py-2.5 tabular-nums text-zinc-500 hidden sm:table-cell">{c.bookings?.toLocaleString() ?? '—'}</td>
                              <td className="text-right py-2.5 tabular-nums text-zinc-500 hidden sm:table-cell">€{((c.revenue_cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}</td>
                              <td className="text-right py-2.5 tabular-nums font-medium text-zinc-700">{((c.conversion_rate ?? 0) * 100).toFixed(1)}%</td>
                              <td className="text-right py-2.5">
                                <a href={`campaigns/${c.id}`} className="opacity-0 group-hover:opacity-100 transition-opacity">
                                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <button
                      onClick={() => { setCampaignModalChannelId(ch.id); setShowCampaignModal(true) }}
                      className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> New Campaign
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <CampaignModal
        open={showCampaignModal}
        onClose={() => setShowCampaignModal(false)}
        onSaved={() => {
          setCampaigns({}) // Clear cache so it refetches
          fetchChannels(dateRange.from, dateRange.to)
        }}
        defaultChannelId={campaignModalChannelId}
      />
    </div>
  )
}
