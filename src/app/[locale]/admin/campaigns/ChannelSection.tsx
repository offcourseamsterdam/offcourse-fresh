'use client'

import { Fragment } from 'react'
import { Loader2, ChevronDown, ChevronUp, Plus, Pencil, Ban } from 'lucide-react'
import { KPICard } from '@/components/admin/tracking/KPICard'
import { CopyUrlButton } from './CopyUrlButton'

export interface Channel {
  id: string
  name: string
  slug: string
  color: string | null
  icon: string | null
  is_active: boolean
}

export interface ChannelWithMetrics extends Channel {
  sessions: number
  unique_visitors: number
  bookings: number
  revenue_cents: number
  conversion_rate: number
}

export interface Campaign {
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

export interface CampaignMetrics {
  sessions: number
  unique_visitors: number
  bookings: number
  revenue_cents: number
  conversion_rate: number
  roi: number | null
}

export interface CampaignBooking {
  id: string
  created_at: string | null
  booking_date: string | null
  start_time: string | null
  listing_title: string | null
  stripe_amount: number | null
  commission_amount_cents: number | null
}

interface PartnerTabsProps {
  campaigns: Campaign[]
  partners: Map<string, string>
  activePartner: string | null
  onSelect: (id: string | null) => void
}

function PartnerTabs({ campaigns, partners, activePartner, onSelect }: PartnerTabsProps) {
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

interface ChannelSectionProps {
  channel: ChannelWithMetrics
  isExpanded: boolean
  onToggle: () => void
  campaigns: Campaign[]
  loadingCampaigns: boolean
  isPartners: boolean
  activePartner: string | null
  onSelectPartner: (id: string | null) => void
  expandedCampaign: string | null
  onToggleCampaign: (id: string) => void
  campaignMetrics: Record<string, CampaignMetrics>
  campaignBookings: Record<string, CampaignBooking[]>
  loadingCampaignDetail: string | null
  partnerNames: Map<string, string>
  listingNames: Map<string, string>
  onEditCampaign: (campaign: Campaign) => void
  onDeactivateCampaign: (campaignId: string, channelId: string) => void
  onAddCampaign: (channelId: string) => void
}

export function ChannelSection({
  channel: ch,
  isExpanded,
  onToggle,
  campaigns: channelCampaigns,
  loadingCampaigns,
  isPartners,
  activePartner,
  onSelectPartner,
  expandedCampaign,
  onToggleCampaign,
  campaignMetrics,
  campaignBookings,
  loadingCampaignDetail,
  partnerNames,
  listingNames,
  onEditCampaign,
  onDeactivateCampaign,
  onAddCampaign,
}: ChannelSectionProps) {
  const visibleCampaigns = activePartner
    ? channelCampaigns.filter(c => c.partner_id === activePartner)
    : channelCampaigns

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      {/* Channel header row */}
      <button
        onClick={onToggle}
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
          {loadingCampaigns ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
            </div>
          ) : channelCampaigns.length === 0 ? (
            <p className="text-xs text-zinc-400 py-4 text-center">No campaigns in this channel yet.</p>
          ) : (
            <>
              {isPartners && (
                <PartnerTabs
                  campaigns={channelCampaigns}
                  partners={partnerNames}
                  activePartner={activePartner}
                  onSelect={onSelectPartner}
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
                      const recentBookings = campaignBookings[c.id]
                      const detailLoading = loadingCampaignDetail === c.id
                      return (
                        <Fragment key={c.id}>
                          <tr
                            onClick={() => onToggleCampaign(c.id)}
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
                                      {metrics && (
                                        <div className={`grid gap-2.5 ${metrics.roi !== null ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
                                          <KPICard label="Sessions" value={metrics.sessions.toLocaleString()} />
                                          <KPICard label="Unique Users" value={metrics.unique_visitors.toLocaleString()} />
                                          <KPICard label="Bookings" value={metrics.bookings.toLocaleString()} />
                                          <KPICard label="Conversion" value={`${(metrics.conversion_rate * 100).toFixed(1)}%`} />
                                          <KPICard label="Revenue" value={`€${(metrics.revenue_cents / 100).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`} />
                                          {metrics.roi !== null && (
                                            <KPICard
                                              label="ROI"
                                              value={`${metrics.roi >= 0 ? '+' : ''}${(metrics.roi * 100).toFixed(0)}%`}
                                              subtitle={metrics.roi >= 0 ? 'positive' : 'negative'}
                                            />
                                          )}
                                        </div>
                                      )}

                                      <div className="bg-zinc-50 rounded-xl border border-zinc-200 p-4">
                                        <h3 className="text-xs font-semibold text-zinc-700 mb-3">Recent Bookings</h3>
                                        {recentBookings && recentBookings.length > 0 ? (
                                          <table className="w-full text-xs">
                                            <thead>
                                              <tr className="text-zinc-400 uppercase tracking-wider border-b border-zinc-200">
                                                <th className="text-left pb-2 font-medium">Booked</th>
                                                <th className="text-left pb-2 font-medium hidden sm:table-cell">Cruise date</th>
                                                <th className="text-left pb-2 font-medium">Cruise</th>
                                                <th className="text-right pb-2 font-medium">Revenue</th>
                                                {recentBookings.some(b => b.commission_amount_cents) && (
                                                  <th className="text-right pb-2 font-medium hidden sm:table-cell">Commission</th>
                                                )}
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100">
                                              {recentBookings.map(b => (
                                                <tr key={b.id}>
                                                  <td className="py-2 text-zinc-500">
                                                    {b.created_at ? new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                                                  </td>
                                                  <td className="py-2 text-zinc-500 hidden sm:table-cell">
                                                    {b.booking_date ? new Date(b.booking_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                                                    {b.start_time ? ` ${b.start_time.slice(0, 5)}` : ''}
                                                  </td>
                                                  <td className="py-2 text-zinc-700 font-medium max-w-[160px] truncate">
                                                    {b.listing_title ?? '—'}
                                                  </td>
                                                  <td className="py-2 text-right tabular-nums text-zinc-700">
                                                    €{((b.stripe_amount ?? 0) / 100).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}
                                                  </td>
                                                  {recentBookings.some(b2 => b2.commission_amount_cents) && (
                                                    <td className="py-2 text-right tabular-nums text-zinc-500 hidden sm:table-cell">
                                                      {b.commission_amount_cents
                                                        ? `€${(b.commission_amount_cents / 100).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`
                                                        : '—'}
                                                    </td>
                                                  )}
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        ) : (
                                          <p className="text-xs text-zinc-400 py-4 text-center">No bookings in this period</p>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-2 pt-1">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); onEditCampaign(c) }}
                                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 hover:bg-zinc-100 transition-colors"
                                        >
                                          <Pencil className="w-3 h-3" /> Edit
                                        </button>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); onDeactivateCampaign(c.id, ch.id) }}
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
            onClick={() => onAddCampaign(ch.id)}
            className="mt-3 flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Campaign
          </button>
        </div>
      )}
    </div>
  )
}
