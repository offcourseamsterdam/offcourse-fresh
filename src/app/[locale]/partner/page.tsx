'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronDown, ChevronUp, Megaphone, BarChart2, Settings, MousePointerClick } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { fmtEuros } from '@/lib/utils'
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker'

// ── Types ──────────────────────────────────────────────────────────────────

interface Overview {
  commission_this_month_cents: number
  bookings_this_month: number
  active_campaigns: number
}

interface Campaign {
  name: string
  slug: string
  is_active: boolean
  commission_rate: string | null
  bookings_count: number
  commission_cents: number
}

interface CampaignWithId extends Campaign { id: string }

interface Booking {
  date: string
  cruise: string
  time: string
  guests: number
  base_price_cents: number
  commission_cents: number
  booked_on: string
}

interface MonthRow {
  month: string
  bookings: number
  base_revenue_cents: number
  commission_cents: number
}

interface CommissionData {
  total_bookings: number
  total_commission_cents: number
  months: MonthRow[]
}

interface QuarterGroup {
  label: string
  months: MonthRow[]
  bookings: number
  commission_cents: number
}

interface CampaignClickRow {
  id: string
  name: string
  slug: string
  is_active: boolean
  clicks: number
  unique_visitors: number
}

interface ClicksData {
  from: string
  to: string
  total_clicks: number
  unique_visitors: number
  by_campaign: CampaignClickRow[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function groupByQuarter(months: MonthRow[]): QuarterGroup[] {
  const map: Record<string, QuarterGroup> = {}
  for (const m of months) {
    const [year, mm] = m.month.split('-')
    const key = `Q${Math.ceil(Number(mm) / 3)} ${year}`
    if (!map[key]) map[key] = { label: key, months: [], bookings: 0, commission_cents: 0 }
    map[key].months.push(m)
    map[key].bookings += m.bookings
    map[key].commission_cents += m.commission_cents
  }
  return Object.values(map)
}

function formatMonth(month: string) {
  const [year, mm] = month.split('-')
  return new Date(Number(year), Number(mm) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function defaultDateRange(): DateRange {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 29)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: fmt(from), to: fmt(to) }
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function KPICard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-zinc-200">
      <p className="text-xs text-zinc-400 mb-1.5">{label}</p>
      <p className="text-2xl font-bold text-[var(--color-primary)]">{value}</p>
    </div>
  )
}

function SectionCard({
  icon,
  title,
  subtitle,
  isOpen,
  onToggle,
  loading,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  isOpen: boolean
  onToggle: () => void
  loading?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-6 py-4 hover:bg-zinc-50 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center flex-shrink-0 text-zinc-500">
          {icon}
        </div>
        <div className="flex-1 text-left">
          <span className="text-sm font-semibold text-zinc-900">{title}</span>
          {subtitle && <span className="text-xs text-zinc-400 ml-2">{subtitle}</span>}
        </div>
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin text-zinc-400 flex-shrink-0" />
        ) : isOpen ? (
          <ChevronUp className="w-4 h-4 text-zinc-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-zinc-100 px-6 py-5">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Mini stat tile for traffic section ────────────────────────────────────

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-zinc-50 rounded-xl px-4 py-3 border border-zinc-100">
      <p className="text-xs text-zinc-400 mb-0.5">{label}</p>
      <p className="text-xl font-bold text-zinc-900 tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PartnerDashboardPage() {
  const params = useParams()
  const locale = (params?.locale as string) ?? 'en'
  const [overview, setOverview] = useState<Overview | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignWithId[]>([])
  const [commission, setCommission] = useState<CommissionData | null>(null)
  const [clicks, setClicks] = useState<ClicksData | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>(defaultDateRange)

  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [loadingCommission, setLoadingCommission] = useState(false)
  const [loadingClicks, setLoadingClicks] = useState(false)

  const [openSection, setOpenSection] = useState<'campaigns' | 'commission' | 'traffic' | null>(null)
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null)
  const [campaignBookings, setCampaignBookings] = useState<Record<string, Booking[]>>({})
  const [loadingCampaignBookings, setLoadingCampaignBookings] = useState<string | null>(null)

  // Load overview KPIs on mount
  useEffect(() => {
    fetch('/api/partner/overview')
      .then(r => r.json())
      .then(json => { if (json.ok) setOverview(json.data) })
      .finally(() => setLoadingOverview(false))
  }, [])

  // Fetch clicks data when traffic section is open + date range changes
  const fetchClicks = useCallback(async (range: DateRange) => {
    setLoadingClicks(true)
    const params = new URLSearchParams({ from: range.from, to: range.to })
    const res = await fetch(`/api/partner/clicks?${params}`)
    const json = await res.json()
    if (json.ok) setClicks(json.data)
    setLoadingClicks(false)
  }, [])

  useEffect(() => {
    if (openSection === 'traffic') {
      fetchClicks(dateRange)
    }
  }, [openSection, dateRange, fetchClicks])

  // Load section data lazily
  async function toggleSection(section: 'campaigns' | 'commission' | 'traffic') {
    if (openSection === section) { setOpenSection(null); return }
    setOpenSection(section)

    if (section === 'campaigns' && campaigns.length === 0) {
      setLoadingCampaigns(true)
      const res = await fetch('/api/partner/campaigns')
      const json = await res.json()
      if (json.ok) setCampaigns(json.data ?? [])
      setLoadingCampaigns(false)
    }

    if (section === 'commission' && !commission) {
      setLoadingCommission(true)
      const res = await fetch('/api/partner/commission')
      const json = await res.json()
      if (json.ok) setCommission(json.data)
      setLoadingCommission(false)
    }
    // traffic section: handled by the useEffect above
  }

  async function toggleCampaignBookings(campaignId: string) {
    if (expandedCampaign === campaignId) { setExpandedCampaign(null); return }
    setExpandedCampaign(campaignId)
    if (campaignBookings[campaignId]) return

    setLoadingCampaignBookings(campaignId)
    const res = await fetch(`/api/partner/campaigns/${campaignId}/bookings`)
    const json = await res.json()
    if (json.ok) setCampaignBookings(prev => ({ ...prev, [campaignId]: json.data }))
    setLoadingCampaignBookings(null)
  }

  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">Partner Overview</h1>
          <p className="text-sm text-zinc-500 mt-1">Your bookings, campaigns, and commission at a glance.</p>
        </div>
        <Link
          href={`/${locale}/partner/settings`}
          className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 hover:bg-white transition-colors"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </Link>
      </div>

      {/* KPI cards */}
      {loadingOverview ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        </div>
      ) : overview ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KPICard label="Commission this month" value={fmtEuros(overview.commission_this_month_cents)} />
          <KPICard label="Bookings this month" value={String(overview.bookings_this_month)} />
          <KPICard label="Active campaigns" value={String(overview.active_campaigns)} />
        </div>
      ) : null}

      {/* Traffic / Clicks section */}
      <SectionCard
        icon={<MousePointerClick className="w-4 h-4" />}
        title="Traffic"
        subtitle={clicks ? `${clicks.total_clicks} clicks · ${clicks.unique_visitors} visitors` : undefined}
        isOpen={openSection === 'traffic'}
        onToggle={() => toggleSection('traffic')}
        loading={loadingClicks && openSection === 'traffic'}
      >
        {/* Date range picker */}
        <div className="mb-5">
          <DateRangePicker
            value={dateRange}
            onChange={range => {
              setDateRange(range)
              setClicks(null)
            }}
          />
        </div>

        {loadingClicks ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
          </div>
        ) : clicks ? (
          <div className="space-y-5">
            {/* Overall totals */}
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Total clicks" value={clicks.total_clicks} sub="link visits in period" />
              <StatTile label="Unique visitors" value={clicks.unique_visitors} sub="distinct visitor IDs" />
            </div>

            {/* Per-campaign breakdown */}
            {clicks.by_campaign.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">By campaign</p>
                <div className="rounded-xl border border-zinc-100 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-zinc-50 text-zinc-400 uppercase tracking-wider">
                        <th className="px-3 py-2 text-left font-medium">Campaign</th>
                        <th className="px-3 py-2 text-right font-medium">Clicks</th>
                        <th className="px-3 py-2 text-right font-medium">Visitors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {clicks.by_campaign.map(c => (
                        <tr key={c.id} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-zinc-800 font-medium">{c.name}</span>
                              {!c.is_active && (
                                <span className="text-[9px] bg-zinc-100 text-zinc-400 px-1 py-0.5 rounded-full">inactive</span>
                              )}
                            </div>
                            <code className="text-zinc-400 font-mono text-[10px]">/t/{c.slug}</code>
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-zinc-900 tabular-nums">
                            {c.clicks}
                          </td>
                          <td className="px-3 py-2.5 text-right text-zinc-600 tabular-nums">
                            {c.unique_visitors}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {clicks.by_campaign.length === 0 && (
              <p className="text-sm text-zinc-400 text-center py-4">
                No clicks recorded in this period.
              </p>
            )}
          </div>
        ) : null}
      </SectionCard>

      {/* Campaigns section */}
      <SectionCard
        icon={<Megaphone className="w-4 h-4" />}
        title="Campaigns"
        subtitle={campaigns.length > 0 ? `${campaigns.length} campaigns` : undefined}
        isOpen={openSection === 'campaigns'}
        onToggle={() => toggleSection('campaigns')}
        loading={loadingCampaigns}
      >
        {campaigns.length === 0 ? (
          <p className="text-sm text-zinc-400">No campaigns yet.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map(c => (
              <div key={c.id ?? c.slug} className="border border-zinc-100 rounded-xl overflow-hidden">
                {/* Campaign header */}
                <button
                  onClick={() => c.id ? toggleCampaignBookings(c.id) : undefined}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-zinc-900">{c.name}</span>
                      {!c.is_active && (
                        <span className="text-[10px] bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded-full">inactive</span>
                      )}
                      {c.commission_rate && (
                        <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
                          {c.commission_rate}
                        </span>
                      )}
                    </div>
                    <code className="text-xs text-zinc-400 font-mono">/t/{c.slug}</code>
                  </div>
                  <div className="flex items-center gap-5 text-right flex-shrink-0">
                    <div>
                      <p className="text-xs text-zinc-400">Bookings</p>
                      <p className="text-sm font-semibold text-zinc-900">{c.bookings_count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-400">Commission</p>
                      <p className="text-sm font-semibold text-[var(--color-primary)]">{fmtEuros(c.commission_cents)}</p>
                    </div>
                    {c.id && (
                      loadingCampaignBookings === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                      ) : expandedCampaign === c.id ? (
                        <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      )
                    )}
                  </div>
                </button>

                {/* Campaign bookings */}
                {c.id && expandedCampaign === c.id && campaignBookings[c.id] && (
                  <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-3">
                    {campaignBookings[c.id].length === 0 ? (
                      <p className="text-xs text-zinc-400 py-2 text-center">No bookings yet for this campaign.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-zinc-400 uppercase tracking-wider">
                            <th className="text-left pb-2 font-medium">Date</th>
                            <th className="text-left pb-2 font-medium hidden sm:table-cell">Cruise</th>
                            <th className="text-right pb-2 font-medium hidden sm:table-cell">Guests</th>
                            <th className="text-right pb-2 font-medium">Revenue</th>
                            <th className="text-right pb-2 font-medium">Commission</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {campaignBookings[c.id].map((b, i) => (
                            <tr key={i}>
                              <td className="py-2 text-zinc-600">
                                {b.date ? new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                              </td>
                              <td className="py-2 text-zinc-700 hidden sm:table-cell max-w-[180px] truncate">{b.cruise}</td>
                              <td className="py-2 text-right text-zinc-600 hidden sm:table-cell">{b.guests}</td>
                              <td className="py-2 text-right tabular-nums text-zinc-700">{fmtEuros(b.base_price_cents)}</td>
                              <td className="py-2 text-right tabular-nums font-semibold text-[var(--color-primary)]">{fmtEuros(b.commission_cents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Commission section */}
      <SectionCard
        icon={<BarChart2 className="w-4 h-4" />}
        title="Commission"
        subtitle={commission ? `${fmtEuros(commission.total_commission_cents)} all time` : undefined}
        isOpen={openSection === 'commission'}
        onToggle={() => toggleSection('commission')}
        loading={loadingCommission}
      >
        {commission && commission.months.length === 0 ? (
          <p className="text-sm text-zinc-400">No commission data yet.</p>
        ) : commission ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-100">
                  <th className="pb-2 pr-4 font-medium">Period</th>
                  <th className="pb-2 pr-4 font-medium text-right">Bookings</th>
                  <th className="pb-2 font-medium text-right">Commission</th>
                </tr>
              </thead>
              <tbody>
                {groupByQuarter(commission.months).map(q => (
                  <>
                    {q.months.map(m => (
                      <tr key={m.month} className="border-b border-zinc-50">
                        <td className="py-2 pr-4 text-zinc-500 pl-3">{formatMonth(m.month)}</td>
                        <td className="py-2 pr-4 text-right text-zinc-500">{m.bookings}</td>
                        <td className="py-2 text-right text-zinc-600">{fmtEuros(m.commission_cents)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-zinc-200 bg-zinc-50">
                      <td className="py-2 pr-4 font-semibold text-zinc-800">{q.label} total</td>
                      <td className="py-2 pr-4 text-right font-semibold text-zinc-800">{q.bookings}</td>
                      <td className="py-2 text-right font-bold text-[var(--color-primary)]">{fmtEuros(q.commission_cents)}</td>
                    </tr>
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300">
                  <td className="pt-3 pr-4 font-bold text-zinc-900">All time</td>
                  <td className="pt-3 pr-4 text-right font-bold text-zinc-900">{commission.total_bookings}</td>
                  <td className="pt-3 text-right font-bold text-[var(--color-primary)]">{fmtEuros(commission.total_commission_cents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </SectionCard>
    </div>
  )
}
