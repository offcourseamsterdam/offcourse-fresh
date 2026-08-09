'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, Calendar, Ship, AlertTriangle, MessageSquare, Clock, PackageX } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { formatAmsterdamTime } from '@/lib/utils'

interface CaptainShift {
  id: string
  startAt: string
  endAt: string
  staffName: string | null
  boatName: string | null
  status: string
}

interface DashboardOverview {
  business: {
    cruisesToday: number
    cruisesThisWeek: number
    revenueThisWeekCents: number
    needsReconciliationCount: number
    lowStock: { name: string; currentCount: number; reorderThreshold: number }[]
  }
  captains: {
    today: CaptainShift[]
    thisWeekByCaptain: { staffName: string; shiftCount: number }[]
    openShiftsThisWeek: number
  }
  aiActivity: {
    openChatsCount: number
    awaitingReviewCount: number
    nextScheduleDigestAt: string
    nextAvailabilityRequest: { targetMonth: string; targetMonthStart: string; triggerDate: string; daysUntil: number }
  }
  agentProgress: { key: string; name: string; autonomy: string }[]
  knownGaps: string[]
}

const AUTONOMY_BADGE: Record<string, 'success' | 'secondary' | 'warning'> = {
  auto: 'success',
  'ask first': 'secondary',
  'dry-run': 'secondary',
  shadow: 'warning',
}

const quickLinks = [
  { label: 'FareHarbor API Tester', href: 'fareharbor', description: 'Test live availability, items & bookings' },
  { label: 'Manage Users', href: 'users', description: 'Invite team members and manage roles' },
]

function KpiCard({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Calendar; accent?: 'amber' }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-zinc-500">{label}</CardTitle>
        <Icon className="w-4 h-4 text-zinc-400" />
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-semibold ${accent === 'amber' ? 'text-amber-600' : 'text-zinc-900'}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

export default function AdminDashboardPage() {
  const { data } = useAdminFetch<DashboardOverview>('/api/admin/dashboard/overview', { refreshInterval: 60_000 })

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">Welcome back — here&apos;s what&apos;s happening.</p>
      </div>

      {/* Business pulse */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
        <KpiCard label="Cruises today" value={data ? String(data.business.cruisesToday) : '—'} icon={Calendar} />
        <KpiCard label="Cruises this week" value={data ? String(data.business.cruisesThisWeek) : '—'} icon={Ship} />
        <KpiCard label="Revenue this week" value={data ? `€${(data.business.revenueThisWeekCents / 100).toFixed(0)}` : '—'} icon={TrendingUp} />
        <KpiCard
          label="Needs reconciliation"
          value={data ? String(data.business.needsReconciliationCount) : '—'}
          icon={AlertTriangle}
          accent={data && data.business.needsReconciliationCount > 0 ? 'amber' : undefined}
        />
      </div>

      {data && data.business.lowStock.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-8 flex items-start gap-2">
          <PackageX className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">Low stock:</span>{' '}
            {data.business.lowStock.map(s => `${s.name} (${s.currentCount}/${s.reorderThreshold})`).join(', ')}
          </p>
        </div>
      )}

      {/* Captains — today and this week */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-3">Captains — today &amp; this week</p>
        {!data ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">Today</p>
              {data.captains.today.length === 0 ? (
                <p className="text-sm text-zinc-400">No cruises scheduled today.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.captains.today.map(s => (
                    <li key={s.id} className="text-sm text-zinc-700 flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      {formatAmsterdamTime(s.startAt)}–{formatAmsterdamTime(s.endAt)} · {s.boatName ?? 'boat TBD'} ·{' '}
                      {s.staffName ? <span className="font-medium">{s.staffName}</span> : <span className="text-amber-600 font-medium">unassigned</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">This week, by captain</p>
              {data.captains.thisWeekByCaptain.length === 0 ? (
                <p className="text-sm text-zinc-400">No shifts assigned yet this week.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.captains.thisWeekByCaptain.map(c => (
                    <li key={c.staffName} className="text-sm text-zinc-700">
                      <span className="font-medium">{c.staffName}</span> — {c.shiftCount} shift{c.shiftCount === 1 ? '' : 's'}
                    </li>
                  ))}
                </ul>
              )}
              {data.captains.openShiftsThisWeek > 0 && (
                <p className="text-xs text-amber-600 mt-2">{data.captains.openShiftsThisWeek} open shift{data.captains.openShiftsThisWeek === 1 ? '' : 's'} this week still need a captain.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI activity */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-3 inline-flex items-center gap-1">
          <MessageSquare className="w-3 h-3" /> AI activity
        </p>
        {!data ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiCard label="Open chats" value={String(data.aiActivity.openChatsCount)} icon={MessageSquare} accent={data.aiActivity.openChatsCount > 0 ? 'amber' : undefined} />
            <KpiCard label="Awaiting review" value={String(data.aiActivity.awaitingReviewCount)} icon={AlertTriangle} accent={data.aiActivity.awaitingReviewCount > 0 ? 'amber' : undefined} />
            <KpiCard label="Next schedule digest" value={formatAmsterdamTime(data.aiActivity.nextScheduleDigestAt)} icon={Clock} />
            <KpiCard label="Next availability request" value={data.aiActivity.nextAvailabilityRequest.daysUntil === 0 ? 'today' : `in ${data.aiActivity.nextAvailabilityRequest.daysUntil}d`} icon={Calendar} />
          </div>
        )}
        <a href="ghost" className="inline-block mt-3 text-xs font-medium text-violet-600 hover:text-violet-800">
          Full AI operations page →
        </a>
      </div>

      {/* Build progress */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-3">Agent build progress</p>
        {!data ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.agentProgress.map(a => (
              <div key={a.key} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5">
                <span className="text-xs text-zinc-700">{a.name}</span>
                <Badge variant={AUTONOMY_BADGE[a.autonomy] ?? 'secondary'}>{a.autonomy}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Known gaps */}
      {data && data.knownGaps.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Known gaps</p>
          <ul className="space-y-1.5 list-disc list-inside">
            {data.knownGaps.map(gap => (
              <li key={gap} className="text-xs text-zinc-600">{gap}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick links */}
      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">Quick access</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {quickLinks.map(link => (
          <a key={link.href} href={link.href}>
            <Card className="hover:bg-zinc-50 transition-colors cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">{link.label}</CardTitle>
                <CardDescription>{link.description}</CardDescription>
              </CardHeader>
            </Card>
          </a>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-2 text-xs text-zinc-400">
        <Badge variant="success">Live</Badge>
        <span>Connected to FareHarbor · Supabase</span>
      </div>
    </div>
  )
}
