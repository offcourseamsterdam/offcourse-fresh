'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, ArrowLeft, Copy, Check, Pencil, Ban, Plus } from 'lucide-react'
import { KPICard } from '@/components/admin/tracking/KPICard'
import { PeriodSelector, getDateRange, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'
import { FunnelChart } from '@/components/admin/tracking/FunnelChart'
import { CampaignModal } from '@/components/admin/tracking/CampaignModal'
import { TrackingLinkModal } from '@/components/admin/tracking/TrackingLinkModal'

interface Campaign {
  id: string
  name: string
  slug: string
  category: string
  channel_id: string | null
  partner_id: string | null
  investment_type: string | null
  investment_amount: number | null
  percentage_value: number | null
  is_active: boolean | null
}

interface TrackingLink {
  id: string
  name: string
  slug: string
  destination_url: string
  commission_type: string
  commission_percentage: number | null
  fixed_commission_amount: number | null
  is_active: boolean | null
  campaign_clicks: { count: number }[]
}

interface FunnelStep {
  event: string
  label: string
  count: number
  drop_off_rate: number
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [dateRange, setDateRange] = useState(getDateRange('30d'))
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [links, setLinks] = useState<TrackingLink[]>([])
  const [funnel, setFunnel] = useState<FunnelStep[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
      const [campaignRes, linksRes, funnelRes] = await Promise.all([
        fetch(`/api/admin/tracking/campaigns/${id}`),
        fetch(`/api/admin/tracking/campaigns/${id}/links`),
        fetch(`/api/admin/tracking/funnel?${params}&campaign_id=${id}`),
      ])
      const [campaignJson, linksJson, funnelJson] = await Promise.all([
        campaignRes.json(),
        linksRes.json(),
        funnelRes.json(),
      ])
      if (campaignJson.ok) setCampaign(campaignJson.data)
      if (linksJson.ok) setLinks(linksJson.data)
      if (funnelJson.ok) setFunnel(funnelJson.data)
    } catch (err) {
      console.error('Failed to load campaign:', err)
    } finally {
      setLoading(false)
    }
  }, [id, dateRange])

  useEffect(() => { fetchData() }, [fetchData])

  function copyLink(slug: string) {
    const url = `${window.location.origin}/api/t/${slug}`
    navigator.clipboard.writeText(url)
    setCopied(slug)
    setTimeout(() => setCopied(null), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (!campaign) {
    return <div className="p-8 text-sm text-zinc-400">Campaign not found</div>
  }

  return (
    <div className="p-6 sm:p-8 max-w-7xl space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <a href="../campaigns" className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 mb-2">
          <ArrowLeft className="w-3 h-3" /> Back to Campaigns
        </a>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{campaign.name}</h1>
            <p className="text-xs text-zinc-400">/{campaign.slug} &middot; {campaign.category}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowEditModal(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 transition-colors">
              <Pencil className="w-3 h-3" /> Edit
            </button>
            <button
              onClick={async () => {
                if (!confirm('Deactivate this campaign?')) return
                await fetch(`/api/admin/tracking/campaigns/${id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ is_active: false }),
                })
                fetchData()
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              <Ban className="w-3 h-3" /> Deactivate
            </button>
            <PeriodSelector value={period} onChange={(key, from, to) => { setPeriod(key); setDateRange({ from, to }) }} />
          </div>
        </div>
      </div>

      {/* Funnel */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-4">Funnel</h2>
        <FunnelChart steps={funnel} />
      </div>

      {/* Tracking Links */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900">Tracking Links</h2>
          <button onClick={() => setShowLinkModal(true)} className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 transition-colors">
            <Plus className="w-3.5 h-3.5" /> New Link
          </button>
        </div>
        {links.length === 0 ? (
          <p className="text-xs text-zinc-400">No tracking links yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-400 uppercase tracking-wider border-b border-zinc-100">
                <th className="text-left py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">URL</th>
                <th className="text-right py-2 font-medium">Clicks</th>
                <th className="text-right py-2 font-medium">Commission</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {links.map((link) => (
                <tr key={link.id}>
                  <td className="py-2.5 font-medium text-zinc-700">{link.name}</td>
                  <td className="py-2.5 text-zinc-400 truncate max-w-[200px]">
                    /api/t/{link.slug}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-zinc-500">
                    {link.campaign_clicks?.[0]?.count ?? 0}
                  </td>
                  <td className="py-2.5 text-right text-zinc-500">
                    {link.commission_type === 'percentage'
                      ? `${link.commission_percentage ?? 0}%`
                      : `€${((link.fixed_commission_amount ?? 0) / 100).toFixed(2)}`}
                  </td>
                  <td className="py-2.5 text-right">
                    <button onClick={() => copyLink(link.slug)} className="text-zinc-400 hover:text-zinc-600">
                      {copied === link.slug ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CampaignModal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSaved={() => fetchData()}
        editing={campaign}
      />

      <TrackingLinkModal
        open={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        onSaved={() => fetchData()}
        campaignId={id}
        partnerId={campaign.partner_id ?? undefined}
      />
    </div>
  )
}
