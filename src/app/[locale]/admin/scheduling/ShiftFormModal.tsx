'use client'

import { useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { TextField, SelectField, TextAreaField } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { formatAmsterdamTime } from '@/lib/utils'
import { SHIFT_STATUSES } from '@/lib/scheduling/shift-schema'
import type { GridShift, GridBoat, GridStaff, AvailabilityMap } from './ShiftsTab'

interface ShiftFormModalProps {
  /** null = create a manual shift */
  shift: GridShift | null
  defaultDate: string
  boats: GridBoat[]
  staff: GridStaff[]
  availability: AvailabilityMap
  /** shifts assigned/confirmed per staff id in the visible week */
  weeklyCounts: Record<string, number>
  onClose: () => void
  onSaved: () => void
}

const AVAILABILITY_LABEL: Record<string, string> = {
  available: '✓ available',
  unavailable: '✗ unavailable',
  prefer_not: '· prefers not',
}

/** "2026-06-20T12:00:00+00:00" → "14:00" (Amsterdam) for <input type=time>. */
function toTimeInput(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  })
}

export function ShiftFormModal({
  shift,
  defaultDate,
  boats,
  staff,
  availability,
  weeklyCounts,
  onClose,
  onSaved,
}: ShiftFormModalProps) {
  const { saving, error, setError, run } = useAdminSave()
  const isManual = !shift || (!shift.booking_id && shift.fareharbor_availability_pk == null)

  const [date, setDate] = useState(shift?.date ?? defaultDate)
  const [startTime, setStartTime] = useState(shift ? toTimeInput(shift.start_at) : '14:00')
  const [endTime, setEndTime] = useState(shift ? toTimeInput(shift.end_at) : '16:00')
  const [boatId, setBoatId] = useState(shift?.boat_id ?? boats[0]?.id ?? '')
  const [staffId, setStaffId] = useState(shift?.staff_id ?? '')
  const [status, setStatus] = useState(shift?.status ?? 'open')
  const [notes, setNotes] = useState(shift?.notes ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const booking = shift?.bookings ?? null

  function staffOption(s: GridStaff): string {
    const avail = availability[`${s.id}:${date}`]
    const availLabel = avail ? ` ${AVAILABILITY_LABEL[avail] ?? ''}` : ''
    const count = weeklyCounts[s.id] ?? 0
    const max = s.max_shifts_per_week ? `/${s.max_shifts_per_week}` : ''
    return `${s.name} (${s.role}) —${availLabel} · ${count}${max} this week`
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    run(async () => {
      if (shift) {
        // status change is explicit; assignment auto-status happens server-side
        const body: Record<string, unknown> = {
          staff_id: staffId || null,
          boat_id: boatId,
          notes: notes.trim() || null,
        }
        if (status !== shift.status) body.status = status
        if (isManual) {
          body.date = date
          body.start_at = new Date(`${date}T${startTime}`).toISOString()
          body.end_at = new Date(`${date}T${endTime}`).toISOString()
        }
        await adminMutate(`/api/admin/scheduling/shifts/${shift.id}`, 'PUT', body)
      } else {
        if (!startTime || !endTime) { setError('Start and end time are required'); throw new Error('Start and end time are required') }
        await adminMutate('/api/admin/scheduling/shifts', 'POST', {
          date,
          start_at: new Date(`${date}T${startTime}`).toISOString(),
          end_at: new Date(`${date}T${endTime}`).toISOString(),
          boat_id: boatId,
          staff_id: staffId || null,
          notes: notes.trim() || null,
        })
      }
      onSaved()
    })
  }

  function handleDelete() {
    run(async () => {
      await adminMutate(`/api/admin/scheduling/shifts/${shift!.id}`, 'DELETE')
      onSaved()
    })
  }

  return (
    <AdminFormModal
      title={shift ? 'Edit shift' : 'Add shift'}
      subtitle={
        booking
          ? `${booking.category === 'shared' ? 'Shared departure' : booking.customer_name} · ${booking.guest_count ?? '?'} guests${booking.listing_title ? ` · ${booking.listing_title}` : ''}`
          : 'Manual shift — maintenance, charter hold, or expected demand'
      }
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel={shift ? 'Save changes' : 'Add shift'}
      footerStart={
        shift && isManual ? (
          confirmingDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700"
            >
              Really delete?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="px-3 py-2 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50"
            >
              Delete
            </button>
          )
        ) : undefined
      }
    >
      {!shift || isManual ? (
        <>
          <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            <TextField label="End" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
        </>
      ) : (
        <p className="text-xs text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2">
          {new Date(shift.start_at).toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam',
          })}{' '}
          {formatAmsterdamTime(shift.start_at)}–{formatAmsterdamTime(shift.end_at)} — times follow the
          booking; re-sync updates them.
        </p>
      )}

      <SelectField label="Boat" value={boatId} onChange={e => setBoatId(e.target.value)}>
        {boats.map(b => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </SelectField>

      <SelectField
        label="Assigned to"
        hint="Availability + assigned shifts shown per person for this date/week"
        value={staffId}
        onChange={e => setStaffId(e.target.value)}
      >
        <option value="">— unassigned —</option>
        {staff.map(s => (
          <option key={s.id} value={s.id}>{staffOption(s)}</option>
        ))}
      </SelectField>

      {shift && (
        <SelectField label="Status" value={status} onChange={e => setStatus(e.target.value)}>
          {SHIFT_STATUSES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </SelectField>
      )}

      <TextAreaField label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
    </AdminFormModal>
  )
}
