'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Wrench, RefreshCw, Mail, ExternalLink } from 'lucide-react'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { formatAmsterdamTime } from '@/lib/utils'

type Priority = 'essential' | 'cosmetic' | 'wishlist'

interface MaintenanceTask {
  id: string
  title: string
  description: string | null
  priority: Priority
  status: 'open' | 'in_progress' | 'done' | 'dismissed'
  photo_urls: string[]
  photo_descriptions: string[]
  reporter: string | null
  source: string
  source_channel: string | null
  proposal_id: string | null
  technician_emailed_at: string | null
  created_at: string
  boat: { name: string } | null
}

const PRIORITY_BADGE: Record<string, string> = {
  essential: 'bg-red-100 text-red-700',
  cosmetic: 'bg-amber-100 text-amber-700',
  wishlist: 'bg-sky-100 text-sky-700',
}
const PRIORITY_LABEL: Record<string, string> = {
  essential: 'Essential',
  cosmetic: 'Cosmetic',
  wishlist: 'Wish-list',
}
const PRIORITY_ORDER: Priority[] = ['essential', 'cosmetic', 'wishlist']

const STATUS_OPTIONS = ['open', 'in_progress', 'done', 'dismissed'] as const
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  dismissed: 'Dismissed',
}

const POLL_MS = 15_000

export default function MaintenancePage() {
  const params = useParams()
  const locale = (params?.locale as string) ?? 'en'
  const { data, isLoading, error, refresh } = useAdminFetch<{ tasks: MaintenanceTask[] }>(
    '/api/admin/maintenance',
    { refreshInterval: POLL_MS },
  )
  const tasks = data?.tasks ?? []
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Priority | 'all'>('all')

  async function setStatus(id: string, status: string) {
    setBusyId(id)
    try {
      await adminMutate('/api/admin/maintenance', 'PATCH', { id, status })
      refresh()
    } catch {
      /* surfaced on next poll */
    } finally {
      setBusyId(null)
    }
  }

  // Count per priority across ALL tasks (so the chips show the full picture).
  const counts = PRIORITY_ORDER.reduce<Record<string, number>>((acc, p) => {
    acc[p] = tasks.filter(t => t.priority === p).length
    return acc
  }, {})

  const visible = filter === 'all' ? tasks : tasks.filter(t => t.priority === filter)
  const open = visible.filter(t => t.status === 'open' || t.status === 'in_progress')
  const closed = visible.filter(t => t.status === 'done' || t.status === 'dismissed')

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 inline-flex items-center gap-2">
            <Wrench className="w-6 h-6 text-violet-500" /> Maintenance &amp; Ideas
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Posts from the Slack channel, triaged by the Ghost into essential, cosmetic and wish-list.
            The drafted technician email and its one-click send live on the{' '}
            <Link href={`/${locale}/admin/ghost`} className="text-violet-600 hover:underline inline-flex items-center gap-0.5">
              Ghost dashboard <ExternalLink className="w-3 h-3" />
            </Link>.
          </p>
        </div>
        <button
          onClick={() => refresh()}
          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md text-zinc-500 hover:bg-zinc-100"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && <AdminErrorBanner error={error} />}

      {/* Priority filter chips */}
      {tasks.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          <FilterChip label="All" count={tasks.length} active={filter === 'all'} onClick={() => setFilter('all')} />
          {PRIORITY_ORDER.map(p => (
            <FilterChip
              key={p}
              label={PRIORITY_LABEL[p]}
              count={counts[p] ?? 0}
              active={filter === p}
              tone={p}
              onClick={() => setFilter(p)}
            />
          ))}
        </div>
      )}

      {isLoading && !data ? (
        <div className="mt-10 flex items-center gap-2 text-zinc-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : tasks.length === 0 ? (
        <p className="mt-10 text-sm text-zinc-400">
          Nothing yet. Posts in the Maintenance &amp; Ideas Slack channel will appear here.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-10 text-sm text-zinc-400">No {PRIORITY_LABEL[filter as Priority]?.toLowerCase()} items.</p>
      ) : (
        <div className="mt-6 space-y-6">
          <Section title={`Open (${open.length})`} tasks={open} busyId={busyId} onStatus={setStatus} />
          {closed.length > 0 && (
            <Section title={`Closed (${closed.length})`} tasks={closed} busyId={busyId} onStatus={setStatus} dim />
          )}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  tone?: Priority
  onClick: () => void
}) {
  // Solid dot from the badge's fill colour (e.g. bg-red-100 → bg-red-400).
  const dot = tone ? PRIORITY_BADGE[tone].split(' ')[0].replace('-100', '-400') : null
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'bg-zinc-900 text-white border-zinc-900'
          : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
      }`}
    >
      {dot && <span className={`w-2 h-2 rounded-full ${active ? 'bg-white' : dot}`} />}
      {label}
      <span className={`${active ? 'text-zinc-300' : 'text-zinc-400'}`}>{count}</span>
    </button>
  )
}

function Section({
  title,
  tasks,
  busyId,
  onStatus,
  dim,
}: {
  title: string
  tasks: MaintenanceTask[]
  busyId: string | null
  onStatus: (id: string, status: string) => void
  dim?: boolean
}) {
  if (!tasks.length) return null
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-2">{title}</h2>
      <div className={`space-y-2 ${dim ? 'opacity-60' : ''}`}>
        {tasks.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-zinc-200 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${PRIORITY_BADGE[t.priority] ?? 'bg-zinc-100 text-zinc-600'}`}>
                {PRIORITY_LABEL[t.priority] ?? t.priority}
              </span>
              <span className="text-sm font-semibold text-zinc-800">{t.title}</span>
              {t.boat?.name && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-medium">{t.boat.name}</span>
              )}
              {t.technician_emailed_at && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium inline-flex items-center gap-1">
                  <Mail className="w-3 h-3" /> emailed
                </span>
              )}
            </div>

            {t.description && <p className="text-sm text-zinc-600 mt-1.5">{t.description}</p>}

            {t.photo_descriptions?.length > 0 && (
              <ul className="mt-2 space-y-1">
                {t.photo_descriptions.map((d, i) => (
                  <li key={i} className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5">
                    📷 {d}
                    {t.photo_urls?.[i]?.startsWith('https://') && (
                      <a href={t.photo_urls[i]} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-violet-600 hover:underline">view</a>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-zinc-100">
              <span className="text-[11px] text-zinc-400">
                {t.reporter ? `${t.reporter} · ` : ''}{formatAmsterdamTime(t.created_at)}
              </span>
              <div className="inline-flex items-center gap-1.5">
                {busyId === t.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />}
                <select
                  value={t.status}
                  onChange={e => onStatus(t.id, e.target.value)}
                  disabled={busyId === t.id}
                  className="text-xs border border-zinc-200 rounded-md px-2 py-1 bg-white text-zinc-700 disabled:opacity-50"
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
