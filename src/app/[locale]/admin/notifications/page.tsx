'use client'

import { useState, useMemo } from 'react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { Bell, ArrowUpRight, ArrowDownLeft, CheckCircle, XCircle, Clock, Search, Zap } from 'lucide-react'
import {
  NOTIFICATION_CATALOG,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  type NotificationCategory,
  type NotificationEntry,
} from '@/lib/slack/catalog'

type Settings = Record<string, { enabled: boolean; notes: string | null; updated_at: string }>

interface LogEntry {
  id: string
  notification_type: string | null
  direction: 'outbound' | 'inbound'
  channel: string | null
  recipient_type: string | null
  message_preview: string | null
  triggered_by: string | null
  sent_at: string
}

interface ApiResponse {
  catalog: NotificationEntry[]
  settings: Settings
  recentLog: LogEntry[]
  envStatus: {
    SLACK_WEBHOOK_URL: boolean
    SLACK_BOT_TOKEN: boolean
    SLACK_SIGNING_SECRET: boolean
    SLACK_MAINTENANCE_CHANNEL_ID: boolean
    SLACK_OPS_CHANNEL: string
    AI_COST_ALERT_SLACK_ID: string
  }
}

const ALL_CATEGORIES: NotificationCategory[] = [
  'booking', 'payment', 'catering', 'operations', 'alerts', 'marketing', 'ai', 'integrations', 'inbound',
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationsPage() {
  const { data, mutate } = useAdminFetch<ApiResponse>('/api/admin/notifications')
  const [activeTab, setActiveTab] = useState<'catalog' | 'log'>('catalog')
  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const settings = data?.settings ?? {}
  const recentLog = useMemo(() => data?.recentLog ?? [], [data])
  const envStatus = data?.envStatus

  function isEnabled(id: string): boolean {
    return settings[id]?.enabled !== false
  }

  async function toggleEnabled(entry: NotificationEntry) {
    const next = !isEnabled(entry.id)
    setTogglingId(entry.id)
    try {
      await fetch('/api/admin/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, enabled: next }),
      })
      await mutate()
    } finally {
      setTogglingId(null)
    }
  }

  const filtered = useMemo(() => {
    return NOTIFICATION_CATALOG.filter(e => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.trigger.toLowerCase().includes(q)
      }
      return true
    })
  }, [categoryFilter, search])

  const countsByCategory = useMemo(() => {
    const counts: Partial<Record<NotificationCategory, number>> = {}
    for (const e of NOTIFICATION_CATALOG) {
      counts[e.category] = (counts[e.category] ?? 0) + 1
    }
    return counts
  }, [])

  const sentToday = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return recentLog.filter(l => new Date(l.sent_at) >= today).length
  }, [recentLog])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-zinc-900 flex items-center justify-center">
          <Bell className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Notification Center</h1>
          <p className="text-sm text-zinc-500">All Slack messages this app sends and receives</p>
        </div>
      </div>

      {/* Config health */}
      {envStatus && (
        <div className="mb-6 flex flex-wrap gap-2">
          {([
            ['Webhook', envStatus.SLACK_WEBHOOK_URL],
            ['Bot token', envStatus.SLACK_BOT_TOKEN],
            ['Signing secret', envStatus.SLACK_SIGNING_SECRET],
            ['Maintenance channel', envStatus.SLACK_MAINTENANCE_CHANNEL_ID],
          ] as [string, boolean][]).map(([label, ok]) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}
            >
              {ok ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-zinc-50 text-zinc-600 border-zinc-200">
            Ops channel: {envStatus.SLACK_OPS_CHANNEL}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-zinc-50 text-zinc-600 border-zinc-200">
            AI alerts → {envStatus.AI_COST_ALERT_SLACK_ID}
          </span>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-lg border border-zinc-200 p-4">
          <p className="text-xs text-zinc-500 mb-1">Notification types</p>
          <p className="text-2xl font-semibold text-zinc-900">{NOTIFICATION_CATALOG.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-zinc-200 p-4">
          <p className="text-xs text-zinc-500 mb-1">Sent today (logged)</p>
          <p className="text-2xl font-semibold text-zinc-900">{sentToday}</p>
        </div>
        <div className="bg-white rounded-lg border border-zinc-200 p-4">
          <p className="text-xs text-zinc-500 mb-1">Log entries (last 100)</p>
          <p className="text-2xl font-semibold text-zinc-900">{recentLog.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-zinc-200">
        {(['catalog', 'log'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {tab === 'catalog' ? `Catalog (${NOTIFICATION_CATALOG.length})` : `Recent sends (${recentLog.length})`}
          </button>
        ))}
      </div>

      {activeTab === 'catalog' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-zinc-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="pl-8 pr-3 py-1.5 text-sm border border-zinc-200 rounded-lg bg-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 w-44"
              />
            </div>
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${categoryFilter === 'all' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
            >
              All ({NOTIFICATION_CATALOG.length})
            </button>
            {ALL_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${categoryFilter === cat ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
              >
                {CATEGORY_LABELS[cat]} ({countsByCategory[cat] ?? 0})
              </button>
            ))}
          </div>

          {/* Catalog table */}
          <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 w-6"></th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 hidden lg:table-cell">Category</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 hidden xl:table-cell">Trigger</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 hidden md:table-cell">Channel / recipient</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 w-20">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map(entry => {
                  const enabled = isEnabled(entry.id)
                  return (
                    <tr key={entry.id} className={`hover:bg-zinc-50 transition-colors ${!enabled ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3 text-zinc-400">
                        {entry.direction === 'outbound'
                          ? <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400" />
                          : <ArrowDownLeft className="w-3.5 h-3.5 text-sky-500" />
                        }
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-zinc-900 leading-tight">{entry.label}</span>
                          {entry.severity === 'critical' && (
                            <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded uppercase tracking-wide">Critical</span>
                          )}
                          {entry.severity === 'warning' && (
                            <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase tracking-wide">Warn</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{entry.description}</p>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[entry.category]}`}>
                          {CATEGORY_LABELS[entry.category]}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell text-xs text-zinc-500 max-w-xs">
                        <span className="line-clamp-2">{entry.trigger}</span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-zinc-500">
                        <code className="bg-zinc-50 px-1.5 py-0.5 rounded text-[11px]">{entry.channel}</code>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleEnabled(entry)}
                          disabled={togglingId === entry.id}
                          title={enabled ? 'Disable this notification' : 'Enable this notification'}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${enabled ? 'bg-zinc-900' : 'bg-zinc-200'} ${togglingId === entry.id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
                          />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-zinc-400 text-sm">
                      No notifications match your filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-zinc-400">
            Toggling a notification records the intent in the database. Enforcement at send sites is rolled out progressively — check the log tab to see live activity.
          </p>
        </>
      )}

      {activeTab === 'log' && (
        <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
          {recentLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-zinc-400">
              <Zap className="w-8 h-8 text-zinc-200" />
              <p className="text-sm">No messages logged yet.</p>
              <p className="text-xs max-w-xs text-center">Messages appear here as soon as Slack sends or receives happen. Logging activates automatically — no config needed.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500">Time</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 w-6"></th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 hidden md:table-cell">Channel</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500">Preview</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 hidden lg:table-cell">Triggered by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {recentLog.map(entry => {
                  const catalogEntry = NOTIFICATION_CATALOG.find(e => e.id === entry.notification_type)
                  return (
                    <tr key={entry.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap">
                        <span title={new Date(entry.sent_at).toLocaleString()}>
                          {timeAgo(entry.sent_at)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {entry.direction === 'outbound'
                          ? <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400" />
                          : <ArrowDownLeft className="w-3.5 h-3.5 text-sky-500" />
                        }
                      </td>
                      <td className="px-4 py-2.5">
                        {catalogEntry ? (
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_COLORS[catalogEntry.category]}`}>
                            {catalogEntry.label}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400 italic">
                            {entry.notification_type ?? 'untyped'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell text-xs text-zinc-500">
                        <code className="bg-zinc-50 px-1 py-0.5 rounded text-[11px]">{entry.channel ?? '—'}</code>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-600 max-w-xs">
                        <span className="line-clamp-1">{entry.message_preview ?? '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell text-xs text-zinc-400">
                        {entry.triggered_by ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Direction legend */}
      <div className="mt-4 flex items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> outbound — we send to Slack</span>
        <span className="flex items-center gap-1"><ArrowDownLeft className="w-3 h-3 text-sky-400" /> inbound — Slack sends to us</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> toggles stored in DB, enforcement rolling out progressively</span>
      </div>
    </div>
  )
}
