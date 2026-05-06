'use client'

import type { AvailabilitySlot } from '@/types'
import { Loader2 } from 'lucide-react'

interface TimeSlotStepProps {
  slots: AvailabilitySlot[]
  loading: boolean
  mode: 'private' | 'shared'
  selectedSlotPk: number | null
  onSelect: (slot: AvailabilitySlot) => void
  /** When no slots available, suggest checking this date (label + callback) */
  suggestDate?: { label: string; onSelect: () => void }
}

function getCapacityColor(ratio: number): string {
  if (ratio > 0.5) return 'bg-emerald-400'
  if (ratio > 0.2) return 'bg-amber-400'
  return 'bg-red-400'
}

function getCapacityLabel(capacity: number): string | null {
  if (capacity <= 3 && capacity > 0) return `${capacity} left`
  return null
}

export function TimeSlotStep({ slots, loading, mode, selectedSlotPk, onSelect, suggestDate }: TimeSlotStepProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)]" />
        <span className="ml-2 text-sm text-zinc-500">Checking availability...</span>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-zinc-700 font-medium">We&apos;re fully booked for this date.</p>
        {suggestDate ? (
          <p className="text-sm text-zinc-500 mt-1">
            Check{' '}
            <button
              type="button"
              onClick={suggestDate.onSelect}
              className="text-[var(--color-primary)] font-semibold hover:underline"
            >
              {suggestDate.label}
            </button>
            ?
          </p>
        ) : (
          <p className="text-xs text-zinc-400 mt-1">Try another date?</p>
        )}
      </div>
    )
  }

  // Find max capacity across all slots for scaling the bars
  const maxCapacity = Math.max(...slots.map(s => s.capacity), 1)

  const WHATSAPP_URL = 'https://wa.me/31645351618'

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 mb-3">Select your preferred departure time</p>

      <div className="grid grid-cols-3 gap-2">
        {slots.map((slot) => {
          const isSelected = selectedSlotPk === slot.pk
          const isSoldOut = slot.capacity < 1
          const isChatToBook = !isSoldOut && slot.callToBook === true
          const capacityRatio = slot.capacity / maxCapacity
          const urgencyLabel = mode === 'shared' ? getCapacityLabel(slot.capacity) : null

          function handleClick() {
            if (isSoldOut) return
            if (isChatToBook) { window.open(WHATSAPP_URL, '_blank'); return }
            onSelect(slot)
          }

          return (
            <button
              key={slot.pk}
              type="button"
              onClick={handleClick}
              disabled={isSoldOut}
              className={`relative overflow-hidden rounded-xl border-2 py-2.5 px-3 text-sm font-semibold transition-all duration-200 ${
                isSoldOut
                  ? 'border-zinc-100 text-zinc-300 cursor-not-allowed line-through bg-zinc-50'
                  : isChatToBook
                    ? 'border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 cursor-pointer'
                    : isSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white scale-[1.02] shadow-md'
                      : 'border-zinc-200 text-zinc-700 bg-white hover:border-[var(--color-primary)] hover:scale-[1.02] cursor-pointer'
              }`}
            >
              {slot.startTime}

              {/* "Chat to book" label — past cutoff, no prior bookings */}
              {isChatToBook && (
                <span className="block text-[10px] font-medium mt-0.5">Chat to book</span>
              )}

              {/* Capacity bar — shared tours only */}
              {mode === 'shared' && !isSoldOut && !isChatToBook && !isSelected && (
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-zinc-100">
                  <div
                    className={`h-full ${getCapacityColor(capacityRatio)} rounded-full transition-all duration-500`}
                    style={{ width: `${capacityRatio * 100}%` }}
                  />
                </div>
              )}

              {/* Urgency label */}
              {urgencyLabel && !isChatToBook && !isSelected && (
                <span className="block text-[10px] font-medium text-amber-600 mt-0.5">
                  {urgencyLabel}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
