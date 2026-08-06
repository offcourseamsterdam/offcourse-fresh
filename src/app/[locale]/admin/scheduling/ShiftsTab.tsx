'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { formatAmsterdamTime, toDateStr } from '@/lib/utils'
import type { Database } from '@/lib/supabase/types'
import { ShiftFormModal } from './ShiftFormModal'

export type GridShift = Database['public']['Tables']['shifts']['Row'] & {
  staff: { name: string } | null
  bookings: {
    customer_name: string
    guest_count: number | null
    category: string | null
    listing_title: string | null
  } | null
}
export type GridBoat = { id: string; name: string }
export type GridStaff = {
  id: string
  name: string
  role: string
  max_shifts_per_week: number | null
}
/** `${staffId}:${date}` → availability status */
export type AvailabilityMap = Record<string, string>

const STATUS_CHIP: Record<string, string> = {
  open: 'bg-amber-50 border-amber-300 text-amber-800',
  assigned: 'bg-blue-50 border-blue-300 text-blue-800',
  confirmed: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  completed: 'bg-zinc-100 border-zinc-200 text-zinc-500',
}

/** Monday of the week containing `d`, as a local Date. */
function mondayOf(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

type ViewMode = 'week' | 'month'

export function ShiftsTab() {
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [editingShift, setEditingShift] = useState<GridShift | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  // Week mode: the 7 visible days. Month mode: every day in the calendar grid,
  // including the leading/trailing days from neighboring months needed to fill
  // out full weeks (so the grid always has complete Mon–Sun rows, like a normal
  // calendar) — both modes fetch through the same from/to range below.
  const days = useMemo(() => {
    if (viewMode === 'week') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        return toDateStr(d)
      })
    }
    const firstOfMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1)
    const lastOfMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0)
    const gridStart = mondayOf(firstOfMonth)
    const gridEnd = mondayOf(lastOfMonth)
    gridEnd.setDate(gridEnd.getDate() + 6)
    const out: string[] = []
    for (const cur = new Date(gridStart); cur <= gridEnd; cur.setDate(cur.getDate() + 1)) {
      out.push(toDateStr(cur))
    }
    return out
  }, [viewMode, weekStart, monthAnchor])
  const from = days[0]
  const to = days[days.length - 1]

  const { data, isLoading, error, refresh } = useAdminFetch<{
    shifts: GridShift[]
    boats: GridBoat[]
    staff: GridStaff[]
    availability: { staff_id: string; date: string; status: string }[]
  }>(`/api/admin/scheduling/shifts?from=${from}&to=${to}`)

  const shifts = useMemo(() => (data?.shifts ?? []).filter(s => s.status !== 'cancelled'), [data])
  const boats = data?.boats ?? []
  const staff = data?.staff ?? []

  /** `${boatId}:${date}` → that cell's shifts, so the grid isn't re-filtering per cell. */
  const shiftsByCell = useMemo(() => {
    const map = new Map<string, GridShift[]>()
    for (const s of shifts) {
      const key = `${s.boat_id}:${s.date}`
      const list = map.get(key)
      if (list) list.push(s)
      else map.set(key, [s])
    }
    return map
  }, [shifts])

  const availability: AvailabilityMap = useMemo(() => {
    const map: AvailabilityMap = {}
    for (const a of data?.availability ?? []) map[`${a.staff_id}:${a.date}`] = a.status
    return map
  }, [data])

  /** date → names of staff marked available that day — the "who could I call for a last-minute booking" view. */
  const availableStaffByDate = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const s of staff) {
      for (const d of days) {
        if (availability[`${s.id}:${d}`] === 'available') (map[d] ??= []).push(s.name)
      }
    }
    return map
  }, [staff, availability, days])

  const today = toDateStr(new Date())
  const modalDefaultDate = today >= from && today <= to ? today : from

  // Scoped to the ISO week containing the relevant day (not just "whatever's on
  // screen") so the count stays correct in month view too, where `shifts` spans
  // several weeks — otherwise the modal's "N shifts this week" would silently
  // mean "this month" whenever a shift is added/edited from the month grid.
  const weeklyCounts = useMemo(() => {
    const targetWeekStart = mondayOf(new Date(`${editingShift?.date ?? modalDefaultDate}T12:00`))
    const targetWeekDays = new Set(
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(targetWeekStart)
        d.setDate(d.getDate() + i)
        return toDateStr(d)
      }),
    )
    const counts: Record<string, number> = {}
    for (const s of shifts) {
      if (!targetWeekDays.has(s.date)) continue
      if (s.staff_id && (s.status === 'assigned' || s.status === 'confirmed')) {
        counts[s.staff_id] = (counts[s.staff_id] ?? 0) + 1
      }
    }
    return counts
  }, [shifts, editingShift, modalDefaultDate])

  /** date → shift totals, for the month view's compact per-day summary. */
  const summaryByDate = useMemo(() => {
    const map: Record<string, { total: number; open: number }> = {}
    for (const s of shifts) {
      const cur = map[s.date] ?? { total: 0, open: 0 }
      cur.total++
      if (s.status === 'open') cur.open++
      map[s.date] = cur
    }
    return map
  }, [shifts])

  function movePeriod(direction: 1 | -1) {
    setSyncResult(null)
    if (viewMode === 'week') {
      setWeekStart(prev => {
        const d = new Date(prev)
        d.setDate(d.getDate() + 7 * direction)
        return d
      })
    } else {
      setMonthAnchor(prev => new Date(prev.getFullYear(), prev.getMonth() + direction, 1))
    }
  }

  function goToToday() {
    setSyncResult(null)
    setWeekStart(mondayOf(new Date()))
    setMonthAnchor(new Date())
  }

  async function syncWeek() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await adminMutate<{ created: number; updated: number; skipped: { reason: string }[] }>(
        '/api/admin/scheduling/sync',
        'POST',
        { from, to },
      )
      setSyncResult(
        `Synced: ${result.created} new, ${result.updated} updated${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`,
      )
      refresh()
    } catch (err) {
      setSyncResult(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const periodLabel =
    viewMode === 'week'
      ? `${new Date(`${from}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(`${to}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : monthAnchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4">
      {/* Period nav + view toggle + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => movePeriod(-1)}
            className="p-2.5 rounded-lg hover:bg-zinc-100 text-zinc-500 min-w-[44px] min-h-[44px] flex items-center justify-center"
            title={viewMode === 'week' ? 'Previous week' : 'Previous month'}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goToToday}
            className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-600 hover:bg-zinc-100 min-h-[44px]"
          >
            Today
          </button>
          <button
            onClick={() => movePeriod(1)}
            className="p-2.5 rounded-lg hover:bg-zinc-100 text-zinc-500 min-w-[44px] min-h-[44px] flex items-center justify-center"
            title={viewMode === 'week' ? 'Next week' : 'Next month'}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="ml-2 text-sm font-medium text-zinc-700">{periodLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-zinc-100 p-0.5">
            {(['week', 'month'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => { setSyncResult(null); setViewMode(mode) }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize min-h-[36px] transition-colors ${
                  viewMode === mode ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={syncWeek} disabled={syncing}>
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync from bookings
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" />
            Add shift
          </Button>
        </div>
      </div>

      {syncResult && (
        <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">{syncResult}</p>
      )}
      <AdminErrorBanner error={error} />

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading shifts…
        </div>
      )}

      {/* Week grid: boats × days. Horizontal scroll on small screens. */}
      {data && viewMode === 'week' && (
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="min-w-[760px] bg-white rounded-xl border border-zinc-200 overflow-hidden">
            {/* Day headers */}
            <div className="grid border-b border-zinc-100" style={{ gridTemplateColumns: '90px repeat(7, 1fr)' }}>
              <div />
              {days.map(d => (
                <div
                  key={d}
                  className={`px-2 py-2 text-center text-xs font-medium ${d === today ? 'text-zinc-900' : 'text-zinc-500'}`}
                >
                  {new Date(`${d}T12:00`).toLocaleDateString('en-GB', { weekday: 'short' })}
                  <span className={`block text-[10px] ${d === today ? 'font-semibold' : 'text-zinc-400'}`}>
                    {new Date(`${d}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              ))}
            </div>

            {/* Availability row — who could take a last-minute booking each day,
                shown with its own row (same weight as the boat rows below) rather
                than squeezed into the date header. */}
            <div className="grid border-b border-zinc-100 bg-zinc-50/40" style={{ gridTemplateColumns: '90px repeat(7, 1fr)' }}>
              <div className="px-3 py-2 text-xs font-semibold text-zinc-700 border-r border-zinc-50 flex items-center">
                Available
              </div>
              {days.map(d => {
                const available = availableStaffByDate[d] ?? []
                return (
                  <div key={d} className={`p-1.5 flex flex-wrap content-start items-center gap-1 min-h-[44px] ${d === today ? 'bg-zinc-50/60' : ''}`}>
                    {available.map(name => (
                      <span
                        key={name}
                        className="text-[11px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium truncate max-w-full"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>

            {boats.map(boat => (
              <div
                key={boat.id}
                className="grid border-b border-zinc-50 last:border-0"
                style={{ gridTemplateColumns: '90px repeat(7, 1fr)' }}
              >
                <div className="px-3 py-3 text-xs font-semibold text-zinc-700 border-r border-zinc-50">
                  {boat.name}
                </div>
                {days.map(d => {
                  const cellShifts = shiftsByCell.get(`${boat.id}:${d}`) ?? []
                  return (
                    <div key={d} className={`p-1.5 space-y-1.5 min-h-[64px] ${d === today ? 'bg-zinc-50/60' : ''}`}>
                      {cellShifts.map(s => (
                        <button
                          key={s.id}
                          onClick={() => setEditingShift(s)}
                          className={`w-full text-left rounded-lg border px-2 py-1.5 text-[11px] leading-tight min-h-[44px] transition-transform hover:scale-[1.02] ${STATUS_CHIP[s.status] ?? STATUS_CHIP.open}`}
                        >
                          <span className="font-semibold block">
                            {formatAmsterdamTime(s.start_at)}–{formatAmsterdamTime(s.end_at)}
                          </span>
                          {s.bookings?.listing_title && (
                            <span className="block truncate opacity-75">{s.bookings.listing_title}</span>
                          )}
                          {!s.booking_id && s.fareharbor_availability_pk == null && (
                            <span className="block opacity-60">manual</span>
                          )}
                          <span className="block truncate">{s.staff?.name ?? 'open'}</span>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Month grid: a bird's-eye overview, not an editing surface — click a day
          to jump into week view there for the actual shift detail/editing. */}
      {data && viewMode === 'month' && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="grid grid-cols-7 border-b border-zinc-100">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => (
              <div key={label} className="px-2 py-2 text-center text-xs font-medium text-zinc-500">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map(d => {
              const inMonth = new Date(`${d}T12:00`).getMonth() === monthAnchor.getMonth()
              const summary = summaryByDate[d]
              const available = availableStaffByDate[d] ?? []
              return (
                <button
                  key={d}
                  onClick={() => { setWeekStart(mondayOf(new Date(`${d}T12:00`))); setViewMode('week') }}
                  className={`min-h-[84px] border-b border-r border-zinc-50 p-1.5 text-left align-top hover:bg-zinc-50 transition-colors ${
                    !inMonth ? 'bg-zinc-50/50' : ''
                  } ${d === today ? 'bg-zinc-50' : ''}`}
                >
                  <span
                    className={`text-xs ${d === today ? 'font-semibold text-zinc-900' : inMonth ? 'text-zinc-600' : 'text-zinc-300'}`}
                  >
                    {new Date(`${d}T12:00`).getDate()}
                  </span>
                  {summary && inMonth && (
                    <div className="mt-1 text-[10px] text-zinc-500">
                      {summary.total} shift{summary.total !== 1 ? 's' : ''}
                      {summary.open ? ` · ${summary.open} open` : ''}
                    </div>
                  )}
                  {available.length > 0 && inMonth && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {available.map(name => (
                        <span
                          key={name}
                          title={`${name} — available`}
                          className="text-[9px] px-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100"
                        >
                          {name.split(' ')[0]}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        {Object.entries({ open: 'Open', assigned: 'Assigned', confirmed: 'Confirmed', completed: 'Completed' }).map(
          ([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded border ${STATUS_CHIP[key]}`} />
              {label}
            </span>
          ),
        )}
      </div>

      {(editingShift || showCreate) && (
        <ShiftFormModal
          shift={editingShift}
          defaultDate={modalDefaultDate}
          boats={boats}
          staff={staff}
          availability={availability}
          weeklyCounts={weeklyCounts}
          onClose={() => { setEditingShift(null); setShowCreate(false) }}
          onSaved={() => { setEditingShift(null); setShowCreate(false); refresh() }}
        />
      )}
    </div>
  )
}
