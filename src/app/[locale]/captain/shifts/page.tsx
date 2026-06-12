'use client'

import { useMemo, useState } from 'react'
import { CalendarPlus, Check, Copy, Loader2 } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { formatAmsterdamTime } from '@/lib/utils'
import { Unlinked, isUnlinked } from '../Unlinked'

interface CaptainShift {
  id: string
  date: string
  start_at: string
  end_at: string
  status: string
  notes: string | null
  boats: { name: string } | null
}

const STATUS_BADGE: Record<string, string> = {
  assigned: 'bg-blue-50 text-blue-700',
  confirmed: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-zinc-100 text-zinc-500',
  open: 'bg-amber-50 text-amber-700',
}

/** Monday of the ISO week containing the date. */
function weekKey(date: string): string {
  const d = new Date(`${date}T12:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export default function CaptainShiftsPage() {
  const { data, isLoading, error } = useAdminFetch<{ shifts: CaptainShift[] }>('/api/captain/shifts')
  const { data: me } = useAdminFetch<{ staff: { calendar_token: string } }>('/api/captain/me')
  const [copied, setCopied] = useState(false)

  const feedUrl = me?.staff.calendar_token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/calendar/${me.staff.calendar_token}.ics`
    : null

  async function copyFeed() {
    if (!feedUrl) return
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the link is still selectable below */
    }
  }

  const weeks = useMemo(() => {
    const map = new Map<string, CaptainShift[]>()
    for (const s of data?.shifts ?? []) {
      const key = weekKey(s.date)
      const list = map.get(key)
      if (list) list.push(s)
      else map.set(key, [s])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [data])

  if (isUnlinked(error)) return <Unlinked />

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">My shifts</h1>
        <p className="text-sm text-zinc-500 mt-1">Two weeks back, eight weeks ahead.</p>
      </div>

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading shifts…
        </div>
      )}
      {error && !isUnlinked(error) && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {data && weeks.length === 0 && (
        <p className="text-sm text-zinc-400 text-center py-12">No shifts in this window.</p>
      )}

      {weeks.map(([monday, shifts]) => (
        <section key={monday} className="space-y-2">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Week of{' '}
            {new Date(`${monday}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
          </h2>
          <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-50">
            {shifts.map(s => (
              <div key={s.id} className={`px-4 py-3 flex items-center justify-between gap-3 ${s.date < today ? 'opacity-60' : ''}`}>
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {new Date(s.start_at).toLocaleDateString('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      timeZone: 'Europe/Amsterdam',
                    })}{' '}
                    · {formatAmsterdamTime(s.start_at)}–{formatAmsterdamTime(s.end_at)}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {s.boats?.name ?? 'boat tbd'}
                    {s.notes ? ` — ${s.notes}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_BADGE[s.status] ?? STATUS_BADGE.open}`}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* Calendar subscription */}
      {feedUrl && (
        <div className="bg-white rounded-2xl border border-zinc-200 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CalendarPlus className="w-4 h-4 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-700">Add to your calendar</h2>
          </div>
          <p className="text-xs text-zinc-500">
            Subscribe once and your shifts show up in Apple/Google Calendar automatically — keep this link private.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-2 overflow-x-auto whitespace-nowrap">
              {feedUrl}
            </code>
            <button
              onClick={copyFeed}
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-zinc-700 border border-zinc-200 rounded-lg px-3 py-2 hover:bg-zinc-50 min-h-[44px]"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
