'use client'

import { Fragment, useState, useEffect, useCallback } from 'react'
import { Loader2, Megaphone, ChevronDown, ChevronUp, Plus, Copy, Check, Pencil, Ban } from 'lucide-react'
import { PeriodSelector, getDateRange, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'
import { CampaignModal } from '@/components/admin/tracking/CampaignModal'
import { CategoryTabs, type CategoryFilter } from '@/components/admin/tracking/CategoryTabs'
import { KPICard } from '@/components/admin/tracking/KPICard'
import { FunnelChart } from '@/components/admin/tracking/FunnelChart'

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
  unique_visitors: number
  bookings: number
  revenue_cents: number
  conversion_rate: number
}

interface Campaign {
  id: string
  name: string
  slug: string
  category: string
  channel_id?: string | null
  partner_id: string | null
  listing_id: string | null
  percentage_value: number | null
  investment_type: string | null
  investment_amount: number | null
  notes?: string | null
  is_active: boolean | null
  sessions?: number
  unique_visitors?: number
  bookings?: number
  revenue_cents?: number
  conversion_rate?: number
  roi?: number | null
}

interface CampaignMetrics {
  sessions: number
  unique_visitors: number
  bookings: number
  revenue_cents: number
  conversion_rate: number
  roi: number | null
}

interface FunnelStep {
  event: string
  label: string
  count: number
  drop_off_rate: number
}

// ── Copy URL helper ──────────────────────────────────────────────────────

function CopyUrlButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)
  const url = `https://offcourseamsterdam.com/t/${slug}`

  function handleCopy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleCopy() }}
      title={url}
      className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ── Partner tabs (for Partners channel) ──────────────────────────────────

function PartnerTabs({
  campaigns,
  partners,
  activePartner,
  onSelect,
}: {
  campaigns: Campaign[]
  partners: Map<string, string>
  activePartner: string | null
  onSelect: (id: string | null) => void
}) {
  // Group campaigns by partner
  const partnerIds = [...new Set(campaigns.map(c => c.partner_id).filter(Boolean))] as string[]

  if (partnerIds.length === 0) return null

  return (
    <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
      <button
        onClick={() => onSelect(null)}
        className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
          activePartner === null
            ? 'bg-zinc-900 text-white'
            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
        }`}
      >
        All
      </button>
      {partnerIds.map(pid => (
        <button
          key={pid}
          onClick={() => onSelect(pid)}
          className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
            activePartner === pid
              ? 'bg-zinc-900 text-white'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
          }`}
        >
          {partners.get(pid) ?? 'Unknown'}
        </button>
      ))}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────

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
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)

  // Expanded campaign row state
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null)
  const [campaignMetrics, setCampaignMetrics] = useState<Record<string, CampaignMetrics>>({})
  const [campaignFunnels, setCampaignFunnels] = useState<Record<string, FunnelStep[]>>({})
  const [loadingCampaignDetail, setLoadingCampaignDetail] = useState<string | null>(null)

  // Partner + listing name lookups
  const [partnerNames, setPartnerNames] = useState<Map<string, string>>(new Map())
  const [listingNames, setListingNames] = useState<Map<string, string>>(new Map())
  const [activePartner, setActivePartner] = useState<string | null>(null)

  // Fetch partners + listings for name lookup
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
    setCampaigns({})
    setCampaignMetrics({})
    setCampaignFunnels({})
    setExpandedChannel(null)
    setExpandedCampaign(null)
  }

  async function toggleCampaign(campaignId: string) {
    if (expandedCampaign === campaignId) {
      setExpandedCampaign(null)
      return
    }
    setExpandedCampaign(campaignId)

    if (campaignMetrics[campaignId] && campaignFunnels[campaignId]) return

    setLoadingCampaignDetail(campaignId)
    try {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
      const [metricsRes, funnelRes] = await Promise.all([
        fetch(`/api/admin/tracking/campaigns/${campaignId}/metrics?${params}`),
        fetch(`/api/admin/tracking/funnel?${params}&campaign_id=${campaignId}`),
      ])
      const [metricsJson, funnelJson] = await Promise.all([metricsRes.json(), funnelRes.json()])
      if (metricsJson.ok) setCampaignMetrics((prev) => ({ ...prev, [campaignId]: metricsJson.data }))
      if (funnelJson.ok) setCampaignFunnels((prev) => ({ ...prev, [campaignId]: funnelJson.data }))
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
    // Refresh campaigns for this channel
    const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
    const res = await fetch(`/api/admin/tracking/channels/${channelId}/campaigns?${params}`)
    const json = await res.json()
    if (json.ok) setCampaigns((prev) => ({ ...prev, [channelId]: json.data }))
  }

  // Check if a channel is the "Partners" channel (has partner-linked campaigns)
  function isPartnersChannel(channelId: string) {
    const ch = channels.find(c => c.id === channelId)
    return ch?.slug === 'partners'
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
            const channelCampaigns = campaigns[ch.id] ?? []
            const isPartners = isPartnersChannel(ch.id)

            // Filter by partner if sub-tab is active
            const visibleCampaigns = activePartner
              ? channelCampaigns.filter(c => c.partner_id === activePartner)
              : channelCampaigns

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
                    <span className="text-zinc-500">{(ch.unique_visitors ?? 0).toLocaleString()} <span className="text-zinc-300">users</span></span>
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
                    ) : channelCampaigns.length === 0 ? (
                      <p className="text-xs text-zinc-400 py-4 text-center">No campaigns in this channel yet.</p>
                    ) : (
                      <>
                        {/* Partner sub-tabs (only for Partners channel) */}
                        {isPartners && (
                          <PartnerTabs
                            campaigns={channelCampaigns}
                            partners={partnerNames}
                            activePartner={activePartner}
                            onSelect={setActivePartner}
                          />
                        )}

                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-zinc-400 uppercase tracking-wider">
                              <th className="text-left py-2 font-medium">Campaign</th>
                              {isPartners && !activePartner && (
                                <th className="text-left py-2 font-medium hidden sm:table-cell">Partner</th>
                              )}
                              <th className="text-right py-2 font-medium hidden sm:table-cell">Sessions</th>
                              <th className="text-right py-2 font-medium hidden sm:table-cell">Users</th>
                              <th className="text-right py-2 font-medium hidden sm:table-cell">Bookings</th>
                              <th className="text-right py-2 font-medium hidden sm:table-cell">Revenue</th>
                              <th className="text-right py-2 font-medium">CR%</th>
                              {visibleCampaigns.some((c) => c.investment_amount) && (
                                <th className="text-right py-2 font-medium hidden sm:table-cell">ROI</th>
                              )}
                              <th className="text-right py-2 font-medium w-20">Link</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100">
                            {(() => {
                              const showRoi = visibleCampaigns.some((cc) => cc.investment_amount)
                              const partnerColShown = isPartners && !activePartner
                              const colSpan = 1 + (partnerColShown ? 1 : 0) + 4 + 1 + (showRoi ? 1 : 0) + 1
                              return visibleCampaigns.map((c) => {
                                const isCampaignExpanded = expandedCampaign === c.id
                                const metrics = campaignMetrics[c.id]
                                const funnel = campaignFunnels[c.id]
                                const detailLoading = loadingCampaignDetail === c.id
                                return (
                                  <Fragment key={c.id}>
                                    <tr
                                      onClick={() => toggleCampaign(c.id)}
                                      className="group cursor-pointer hover:bg-zinc-100/60 transition-colors"
                                    >
                                      <td className="py-2.5">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-medium text-zinc-700">{c.name}</span>
                                          {c.percentage_value && c.investment_type === 'percentage' && (
                                            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
                                              {c.percentage_value}%
                                            </span>
                                          )}
                                          <span className="text-[10px] text-zinc-400">
                                            → {c.listing_id ? listingNames.get(c.listing_id) ?? 'Cruise' : 'Homepage'}
                                          </span>
                                        </div>
                                      </td>
                                      {partnerColShown && (
                                        <td className="py-2.5 text-zinc-400 hidden sm:table-cell">
                                          {c.partner_id ? partnerNames.get(c.partner_id) ?? '—' : '—'}
                                        </td>
                                      )}
                                      <td className="text-right py-2.5 tabular-nums text-zinc-500 hidden sm:table-cell">{c.sessions?.toLocaleString() ?? '—'}</td>
                                      <td className="text-right py-2.5 tabular-nums text-zinc-500 hidden sm:table-cell">{c.unique_visitors?.toLocaleString() ?? '—'}</td>
                                      <td className="text-right py-2.5 tabular-nums text-zinc-500 hidden sm:table-cell">{c.bookings?.toLocaleString() ?? '—'}</td>
                                      <td className="text-right py-2.5 tabular-nums text-zinc-500 hidden sm:table-cell">€{((c.revenue_cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}</td>
                                      <td className="text-right py-2.5 tabular-nums font-medium text-zinc-700">{((c.conversion_rate ?? 0) * 100).toFixed(1)}%</td>
                                      {showRoi && (
                                        <td className="text-right py-2.5 tabular-nums hidden sm:table-cell">
                                          {c.roi != null ? (
                                            <span className={`font-medium ${c.roi >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                              {c.roi >= 0 ? '+' : ''}{(c.roi * 100).toFixed(0)}%
                                            </span>
                                          ) : (
                                            <span className="text-zinc-300">—</span>
                                          )}
                                        </td>
                                      )}
                                      <td className="text-right py-2.5">
                                        <div className="flex items-center justify-end gap-1">
                                          <CopyUrlButton slug={c.slug} />
                                          {isCampaignExpanded ? (
                                            <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                                          ) : (
                                            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                    {isCampaignExpanded && (
                                      <tr>
                                        <td colSpan={colSpan} className="bg-white border-t border-zinc-100 px-0 py-0">
                                          <div className="p-5 space-y-5">
                                            {detailLoading && !metrics ? (
                                              <div className="flex items-center justify-center py-6">
                                                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                                              </div>
                                            ) : (
                                              <>
                                                {/* KPI cards */}
                                                {metrics && (
                                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                                                    <KPICard label="Sessions" value={metrics.sessions.toLocaleString()} />
                                                    <KPICard label="Unique Users" value={metrics.unique_visitors.toLocaleString()} />
                                                    <KPICard label="Bookings" value={metrics.bookings.toLocaleString()} />
                                                    <KPICard label="Conversion" value={`${(metrics.conversion_rate * 100).toFixed(1)}%`} />
                                                    <KPICard label="Revenue" value={`€${(metrics.revenue_cents / 100).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`} />
                                                    {metrics.roi !== null ? (
                                                      <KPICard
                                                        label="ROI"
                                                        value={`${metrics.roi >= 0 ? '+' : ''}${(metrics.roi * 100).toFixed(0)}%`}
                                                        subtitle={metrics.roi >= 0 ? 'positive' : 'negative'}
                                                      />
                                                    ) : (
                                                      <KPICard label="ROI" value="—" subtitle="no investment set" />
                                                    )}
                                                  </div>
                                                )}

                                                {/* Funnel */}
                                                <div className="bg-zinc-50 rounded-xl border border-zinc-200 p-4">
                                                  <h3 className="text-xs font-semibold text-zinc-700 mb-3">Funnel</h3>
                                                  {funnel && funnel.length > 0 ? (
                                                    <FunnelChart steps={funnel} />
                                                  ) : (
                                                    <p className="text-xs text-zinc-400 py-4 text-center">No funnel data for this period</p>
                                                  )}
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-2 pt-1">
                                                  <button
                                                    onClick={(e) => { e.stopPropagation(); setEditingCampaign(c); setShowCampaignModal(true) }}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                                                  >
                                                    <Pencil className="w-3 h-3" /> Edit
                                                  </button>
                                                  <button
                                                    onClick={(e) => { e.stopPropagation(); deactivateCampaign(c.id, ch.id) }}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                                                  >
                                                    <Ban className="w-3 h-3" /> Deactivate
                                                  </button>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                )
                              })
                            })()}
                          </tbody>
                        </table>
                      </>
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
        onClose={() => { setShowCampaignModal(false); setEditingCampaign(null) }}
        onSaved={() => {
          setCampaigns({})
          setCampaignMetrics({})
          setCampaignFunnels({})
          fetchChannels(dateRange.from, dateRange.to)
          // Re-fetch campaigns for the currently expanded channel
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
