'use client'

import { useState } from 'react'
import { Loader2, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtAdminTime } from '@/lib/admin/format'

interface Slot {
  pk: number
  start_at: string
  end_at: string
  customer_type_rate_pk: number
  label: string
}

export interface RescheduleBookingModalProps {
  bookingId: string
  listingId: string | null
  currentDate: string | null
  currentStartAt: string | null
  guestName: string | null
  cruiseTitle: string | null
  onClose: () => void
  onSuccess: () => void
}

export function RescheduleBookingModal({
  bookingId,
  listingId,
  currentDate,
  currentStartAt,
  guestName,
  cruiseTitle,
  onClose,
  onSuccess,
}: RescheduleBookingModalProps) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const [date, setDate] = useState(tomorrowStr)
  const [slots, setSlots] = useState<Slot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slotsFetched, setSlotsFetched] = useState(false)

  async function fetchSlots(selectedDate: string) {
    if (!listingId) {
      setError('No listing ID on this booking — cannot fetch slots')
      return
    }
    setLoadingSlots(true)
    setSlots([])
    setSelectedSlot(null)
    setError(null)
    try {
      const res = await fetch(`/api/admin/booking-flow?date=${selectedDate}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Failed to fetch slots')

      type RawSlot = {
        pk: number
        start_at: string
        end_at: string
        customer_type_rates: Array<{ pk: number }>
      }
      type RawListing = { id: string; slots: RawSlot[] }

      const listing = (json.data as RawListing[]).find(l => l.id === listingId)

      if (!listing || listing.slots.length === 0) {
        setSlots([])
        setSlotsFetched(true)
        return
      }

      // One radio option per slot (use first available customer_type_rate)
      const parsed: Slot[] = listing.slots
        .filter(s => s.customer_type_rates.length > 0)
        .map(s => ({
          pk: s.pk,
          start_at: s.start_at,
          end_at: s.end_at,
          customer_type_rate_pk: s.customer_type_rates[0].pk,
          label: `${fmtAdminTime(s.start_at)} – ${fmtAdminTime(s.end_at)}`,
        }))

      setSlots(parsed)
      setSlotsFetched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch slots')
    } finally {
      setLoadingSlots(false)
    }
  }

  async function handleConfirm() {
    if (!selectedSlot) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/rebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newAvailPk: selectedSlot.pk,
          newCustomerTypeRatePk: selectedSlot.customer_type_rate_pk,
          newDate: date,
          newStartAt: selectedSlot.start_at,
          newEndAt: selectedSlot.end_at,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Rebook failed')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Reschedule booking</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              Pick a new date and slot. The original FareHarbor booking will be cancelled.
            </p>
          </div>
        </div>

        <div className="bg-zinc-50 rounded-lg px-4 py-3 space-y-1 text-sm">
          <p className="font-medium text-zinc-900">{guestName ?? '—'}</p>
          <p className="text-zinc-500">{cruiseTitle ?? '—'}</p>
          <p className="text-zinc-400">
            Currently: {currentDate ?? '—'}
            {currentStartAt ? ` at ${fmtAdminTime(currentStartAt)}` : ''}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">New date</label>
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              min={tomorrowStr}
              onChange={e => {
                setDate(e.target.value)
                setSlotsFetched(false)
                setSlots([])
                setSelectedSlot(null)
              }}
              className="flex-1 border border-zinc-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
            <Button variant="outline" size="sm" onClick={() => fetchSlots(date)} disabled={loadingSlots}>
              {loadingSlots ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Check slots'}
            </Button>
          </div>
        </div>

        {slotsFetched && slots.length === 0 && !loadingSlots && (
          <p className="text-sm text-zinc-400">No available slots on this date for this cruise.</p>
        )}

        {slots.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-zinc-500">Available slots</p>
            {slots.map(slot => (
              <label
                key={slot.pk}
                className="flex items-center gap-2.5 cursor-pointer"
              >
                <input
                  type="radio"
                  name="slot"
                  checked={selectedSlot?.pk === slot.pk}
                  onChange={() => setSelectedSlot(slot)}
                  className="accent-zinc-900"
                />
                <span className="text-sm text-zinc-700">{slot.label}</span>
              </label>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Go back</Button>
          <Button size="sm" onClick={handleConfirm} disabled={saving || !selectedSlot}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Rescheduling…' : 'Confirm reschedule'}
          </Button>
        </div>
      </div>
    </div>
  )
}
