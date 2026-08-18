'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Bell, Loader2, RefreshCw, ArrowRight, AlertTriangle, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import {
  getSlackNotificationType,
  type SlackNotificationDestination,
} from '@/lib/slack/notification-types'
import { CategoryBadge, DestinationBadge, KindCode, SeverityBadge } from './badges'

interface SlackNotificationRow {
  id: string
  created_at: string
  kind: string
  destination: string
  channel: string | null
  text: string
  status: string
  error: string | null
}

interface FeedData {
  notifications: SlackNotificationRow[]
  counts: Record<string, number>
  total: number
  failed: number
  days: number
  truncated: boolean
}

const WINDOWS = [
  { days: 1, label: '24h' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

/** Amsterdam-local timestamp, matching the rest of the admin. */
function fmtSentAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  })
}

export default function AdminNotificationsPage() {
  const { locale } = useParams<{ locale: string }>()
  const [days, setDays] = useState(7)
  const [kindFilter, setKindFilter] = useState<string | null>(null)

  const query = `/api/admin/notifications?days=${days}${kindFilter ? `&kind=${encodeURIComponent(kindFilter)}` : ''}`
  const { data, isLoading, error, refresh } = useAdminFetch<FeedData>(query)

  const rows = data?.notifications ?? []
  const counts = useMemo(() => data?.counts ?? {}, [data])

  // Filter chips: only kinds that actually fired in this window, busiest first.
  // Showing every catalogued type here would bury the two that matter today —
  // the full list lives on the types page instead.
  const activeKinds = useMemo(
    () => Object.entries(counts).sort((a, b) => b[1] - a[1]),
    [counts],
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-none space-y-5 sm:space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 flex items-center gap-2">
            <Bell className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500" />
            Slack Notifications
          </h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
            Everything the site has told you on Slack — bookings, payments, catering and the alerts
            nobody wants to miss. Sent messages are logged here even if Slack itself was down.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading} className="min-h-[44px] sm:min-h-0">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Clickthrough to the catalog of every notification type */}
      <Link
        href={`/${locale}/admin/notifications/types`}
        className="group flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors min-h-[44px]"
      >
        <div className="flex items-start sm:items-center gap-3">
          <MessageSquare className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <div className="text-sm font-medium text-zinc-900">See all notification types</div>
            <div className="text-xs text-zinc-500">
              What each alert means, when it fires, and what to do about it
            </div>
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all shrink-0" />
      </Link>

      {error && <AdminErrorBanner error={error} />}

      {/* Window + summary */}
      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map(w => (
          <button
            key={w.days}
            onClick={() => setDays(w.days)}
            className={`rounded-full border px-3 py-2 text-xs font-medium transition-colors min-h-[36px] ${
              days === w.days
                ? 'border-zinc-900 bg-zinc-900 text-white'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
            }`}
          >
            Last {w.label}
          </button>
        ))}
        {data && (
          <span className="text-xs text-zinc-500 ml-1">
            {data.total} message{data.total === 1 ? '' : 's'}
            {data.failed > 0 && (
              <span className="text-red-600 font-medium"> · {data.failed} failed to send</span>
            )}
          </span>
        )}
      </div>

      {/* Per-kind filter chips */}
      {activeKinds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setKindFilter(null)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              kindFilter === null
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
            }`}
          >
            All types
          </button>
          {activeKinds.map(([kind, count]) => {
            const type = getSlackNotificationType(kind)
            return (
              <button
                key={kind}
                onClick={() => setKindFilter(kind === kindFilter ? null : kind)}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  kindFilter === kind
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
                }`}
              >
                {type?.label ?? kind} <span className="text-zinc-400">({count})</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Feed */}
      {isLoading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading notifications…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState days={days} filtered={kindFilter !== null} />
      ) : (
        <div className="space-y-3">
          {rows.map(row => (
            <NotificationCard key={row.id} row={row} />
          ))}
          {data?.truncated && (
            <p className="text-xs text-zinc-400 text-center py-2">
              Showing the most recent {rows.length} — narrow the window or pick a type to see further back.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function NotificationCard({ row }: { row: SlackNotificationRow }) {
  const type = getSlackNotificationType(row.kind)
  const failed = row.status === 'failed'

  return (
    <div
      className={`rounded-xl border bg-white overflow-hidden ${
        failed ? 'border-red-200' : 'border-zinc-200'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60">
        <span className="text-sm font-medium text-zinc-900">{type?.label ?? row.kind}</span>
        {type && <SeverityBadge severity={type.severity} />}
        {type && <CategoryBadge category={type.category} />}
        <DestinationBadge destination={(row.destination === 'dm' ? 'dm' : 'channel') as SlackNotificationDestination} />
        <span className="text-xs text-zinc-400 sm:ml-auto w-full sm:w-auto">{fmtSentAt(row.created_at)}</span>
      </div>

      {/* The message exactly as Slack received it — mono, wrapped, scrollable if huge */}
      <pre className="px-4 py-3 text-xs sm:text-[13px] text-zinc-700 whitespace-pre-wrap break-words font-mono max-h-64 overflow-y-auto">
        {row.text}
      </pre>

      {failed && (
        <div className="flex items-start gap-2 px-4 py-2.5 border-t border-red-100 bg-red-50 text-xs text-red-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Slack rejected this message{row.error ? `: ${row.error}` : ''}. It was written here so it isn’t lost —
            act on it as if you had seen it in Slack.
          </span>
        </div>
      )}

      <div className="px-4 py-2 border-t border-zinc-100 flex flex-wrap items-center gap-2">
        <KindCode kind={row.kind} />
        {type && <span className="text-[11px] text-zinc-500">{type.action}</span>}
      </div>
    </div>
  )
}

function EmptyState({ days, filtered }: { days: number; filtered: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-6 py-12 text-center">
      <Bell className="w-6 h-6 text-zinc-300 mx-auto mb-3" />
      <p className="text-sm text-zinc-600 font-medium">
        {filtered ? 'Nothing of this type in the last ' : 'No Slack notifications in the last '}
        {days} day{days === 1 ? '' : 's'}
      </p>
      <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
        Quiet is usually good news. Note that only messages sent after this log went live appear
        here — anything older lives only in Slack.
      </p>
    </div>
  )
}
