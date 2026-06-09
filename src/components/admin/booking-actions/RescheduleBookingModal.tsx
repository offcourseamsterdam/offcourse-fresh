'use client'

import { useState, useEffect } from 'react'
import { Loader2, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtAdminTime } from '@/lib/admin/format'

// ── Types ──────────────────────────────────────────────────────────────────

interface CustomerTypeOption {
  pk: number
  name: string
}

interface Slot {
  pk: number
  start_at: string
  end_at: string
  availableTypes: CustomerTypeOption[]
  label: string
}

export interface RescheduleBookingModalProps {
  bookingId: string
  listingId: string | null
  currentDate: string | null
  currentStartAt: string | null
  guestName: string | null
  cruiseTitle: string | null
  /** 'private' | 'shared' | null — controls whether the customer type picker is shown */
  category: string | null
  /** Name of the original customer type (e.g. "Diana - 1.5 Hours") — used to pre-select the right rate */
  originalCustomerTypeName: string | null
  onClose: () => void
  onSuccess: () => void
}

// ── Component ──────────────────────────────────────────────────────────────

export function RescheduleBookingModal({
  bookingId,
  listingId,
  currentDate,
  currentStartAt,
  guestName,
  cruiseTitle,
  category,
  originalCustomerTypeName,
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
  const [selectedTypePk, setSelectedTypePk] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slotsFetched, setSlotsFetched] = useState(false)

  const isPrivate = category === 'private'

  // Lock background scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // When the selected slot changes, auto-select the best matching customer type rate
  useEffect(() => {
    if (!selectedSlot) { setSelectedTypePk(null); return }
    const types = selectedSlot.availableTypes
    if (types.length === 0) { setSelectedTypePk(null); return }

    // Try to match by name to keep the same boat + duration as the original booking.
    // PKs change per availability slot in FareHarbor, but names are stable.
    const nameMatch = originalCustomerTypeName
      ? types.find(t => t.name === originalCustomerTypeName)
      : null

    setSelectedTypePk(nameMatch?.pk ?? types[0].pk)
  }, [selectedSlot, originalCustomerTypeName])

  async function fetchSlots(selectedDate: string) {
    if (!listingId) {
      setError('No listing ID on this booking — cannot fetch slots')
      return
    }
    setLoadingSlots(true)
    setSlots([])
    setSelectedSlot(null)
    setSelectedTypePk(null)
    setError(null)
    try {
      const res = await fetch(`/api/admin/booking-flow?date=${selectedDate}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Failed to fetch slots')

      type RawCustomerTypeRate = {
        pk: number
        customer_type: { pk: number; singular: string; plural: string }
      }
      type RawSlot = {
        pk: number
        start_at: string
        end_at: string
        customer_type_rates: RawCustomerTypeRate[]
      }
      type RawListing = { id: string; slots: RawSlot[] }

      const listing = (json.data as RawListing[]).find(l => l.id === listingId)

      if (!listing || listing.slots.length === 0) {
        setSlots([])
        setSlotsFetched(true)
        return
      }

      const parsed: Slot[] = listing.slots
        .filter(s => s.customer_type_rates.length > 0)
        .map(s => ({
          pk: s.pk,
          start_at: s.start_at,
          end_at: s.end_at,
          availableTypes: s.customer_type_rates.map(r => ({
            pk: r.pk,
            name: r.customer_type.singular,
          })),
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
    if (!selectedSlot || !selectedTypePk) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/rebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newAvailPk: selectedSlot.pk,
          newCustomerTypeRatePk: selectedTypePk,
          newCustomerTypeName: selectedTypeName ?? undefined,
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

  const selectedTypeName = selectedSlot?.availableTypes.find(t => t.pk === selectedTypePk)?.name ?? null
  const canConfirm = !!selectedSlot && !!selectedTypePk

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-5">

          {/* Header */}
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

          {/* Current booking summary */}
          <div className="bg-zinc-50 rounded-lg px-4 py-3 space-y-1 text-sm">
            <p className="font-medium text-zinc-900">{guestName ?? '—'}</p>
            <p className="text-zinc-500">{cruiseTitle ?? '—'}</p>
            <p className="text-zinc-400">
              Currently: {currentDate ?? '—'}
              {currentStartAt ? ` at ${fmtAdminTime(currentStartAt)}` : ''}
              {originalCustomerTypeName ? ` · ${originalCustomerTypeName}` : ''}
            </p>
          </div>

          {/* Date picker */}
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
                  setSelectedTypePk(null)
                }}
                className="flex-1 border border-zinc-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
              <Button variant="outline" size="sm" onClick={() => fetchSlots(date)} disabled={loadingSlots}>
                {loadingSlots ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Check slots'}
              </Button>
            </div>
          </div>

          {/* No slots found */}
          {slotsFetched && slots.length === 0 && !loadingSlots && (
            <p className="text-sm text-zinc-400">No available slots on this date for this cruise.</p>
          )}

          {/* Time slot grid */}
          {slots.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-2">Available slots</p>
              <div className="grid grid-cols-3 gap-1.5">
                {slots.map(slot => (
                  <label
                    key={slot.pk}
                    className={`flex items-center gap-1.5 cursor-pointer rounded-md border px-2 py-1.5 text-xs transition-colors ${
                      selectedSlot?.pk === slot.pk
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 text-zinc-700 hover:border-zinc-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="slot"
                      checked={selectedSlot?.pk === slot.pk}
                      onChange={() => setSelectedSlot(slot)}
                      className="sr-only"
                    />
                    {slot.label.split(' – ')[0]}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Customer type picker — only for private bookings with a slot selected */}
          {isPrivate && selectedSlot && selectedSlot.availableTypes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-2">Boat &amp; duration</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedSlot.availableTypes.map(type => (
                  <button
                    key={type.pk}
                    type="button"
                    onClick={() => setSelectedTypePk(type.pk)}
                    className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                      selectedTypePk === type.pk
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-zinc-200 text-zinc-700 hover:border-zinc-400'
                    }`}
                  >
                    {type.name}
                  </button>
                ))}
              </div>
              {selectedTypeName && (
                <p className="text-xs text-zinc-400 mt-1.5">
                  Selected: <span className="font-medium text-zinc-600">{selectedTypeName}</span>
                  {originalCustomerTypeName && selectedTypeName !== originalCustomerTypeName && (
                    <span className="text-amber-600 ml-1">(changed from {originalCustomerTypeName})</span>
                  )}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        </div>{/* end scrollable body */}

        {/* Footer */}
        <div className="flex gap-2 justify-end px-6 py-4 border-t border-zinc-100 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Go back</Button>
          <Button size="sm" onClick={handleConfirm} disabled={saving || !canConfirm}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Rescheduling…' : 'Confirm reschedule'}
          </Button>
        </div>
      </div>
    </div>
  )
}
