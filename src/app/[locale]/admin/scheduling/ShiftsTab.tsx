'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { formatAmsterdamTime } from '@/lib/utils'
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

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ShiftsTab() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [editingShift, setEditingShift] = useState<GridShift | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        return isoDate(d)
      }),
    [weekStart],
  )
  const from = days[0]
  const to = days[6]

  const { data, isLoading, error, refresh } = useAdminFetch<{
    shifts: GridShift[]
    boats: GridBoat[]
    staff: GridStaff[]
    availability: { staff_id: string; date: string; status: string }[]
  }>(`/api/admin/scheduling/shifts?from=${from}&to=${to}`)

  const shifts = useMemo(() => (data?.shifts ?? []).filter(s => s.status !== 'cancelled'), [data])
  const boats = data?.boats ?? []
  const staff = data?.staff ?? []

  const availability: AvailabilityMap = useMemo(() => {
    const map: AvailabilityMap = {}
    for (const a of data?.availability ?? []) map[`${a.staff_id}:${a.date}`] = a.status
    return map
  }, [data])

  const weeklyCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of shifts) {
      if (s.staff_id && (s.status === 'assigned' || s.status === 'confirmed')) {
        counts[s.staff_id] = (counts[s.staff_id] ?? 0) + 1
      }
    }
    return counts
  }, [shifts])

  function moveWeek(deltaDays: number) {
    setSyncResult(null)
    setWeekStart(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + deltaDays)
      return d
    })
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

  const weekLabel = `${new Date(`${from}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(`${to}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  const today = isoDate(new Date())

  return (
    <div className="space-y-4">
      {/* Week nav + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => moveWeek(-7)}
            className="p-2.5 rounded-lg hover:bg-zinc-100 text-zinc-500 min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setSyncResult(null); setWeekStart(mondayOf(new Date())) }}
            className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-600 hover:bg-zinc-100 min-h-[44px]"
          >
            Today
          </button>
          <button
            onClick={() => moveWeek(7)}
            className="p-2.5 rounded-lg hover:bg-zinc-100 text-zinc-500 min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="ml-2 text-sm font-medium text-zinc-700">{weekLabel}</span>
        </div>
        <div className="flex items-center gap-2">
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
      {data && (
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
                  const cellShifts = shifts.filter(s => s.boat_id === boat.id && s.date === d)
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
                          <span className="block truncate">
                            {s.staff?.name ?? 'open'}
                            {s.bookings?.category === 'shared' && ' · shared'}
                            {!s.booking_id && s.fareharbor_availability_pk == null && ' · manual'}
                          </span>
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
          defaultDate={today >= from && today <= to ? today : from}
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
