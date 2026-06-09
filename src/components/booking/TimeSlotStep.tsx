'use client'

import { useState } from 'react'
import type { AvailabilitySlot } from '@/types'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { trackWhatsAppClick } from '@/lib/tracking/client'

interface TimeSlotStepProps {
  slots: AvailabilitySlot[]
  loading: boolean
  mode: 'private' | 'shared'
  selectedSlotPk: number | null
  onSelect: (slot: AvailabilitySlot) => void
  /** When no slots available, suggest checking this date (label + callback) */
  suggestDate?: { label: string; onSelect: () => void }
}

const MAX_VISIBLE = 9  // 3 columns × 3 rows — matches Booking.com style
const WHATSAPP_URL = 'https://wa.me/31645351618'

function getCapacityColor(ratio: number): string {
  if (ratio > 0.5) return 'bg-emerald-400'
  if (ratio > 0.2) return 'bg-amber-400'
  return 'bg-red-400'
}

function getCapacityLabel(capacity: number): string | null {
  if (capacity <= 3 && capacity > 0) return `${capacity} left`
  return null
}

/**
 * Given the selected slot index, compute the start of the 9-slot window so the
 * selected slot is roughly centred (4 before, selected, 4 after — clamped at
 * both ends). When nothing is selected, starts from 0.
 */
function windowStart(slots: AvailabilitySlot[], selectedPk: number | null): number {
  if (selectedPk === null) return 0
  const idx = slots.findIndex(s => s.pk === selectedPk)
  if (idx < 0) return 0
  const HALF = Math.floor(MAX_VISIBLE / 2) // 4
  const start = Math.max(0, Math.min(idx - HALF, slots.length - MAX_VISIBLE))
  return start
}

export function TimeSlotStep({ slots, loading, mode, selectedSlotPk, onSelect, suggestDate }: TimeSlotStepProps) {
  const [showAll, setShowAll] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)]" />
        <span className="ml-2 text-sm text-zinc-500">Checking availability…</span>
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

  const maxCapacity = Math.max(...slots.map(s => s.capacity), 1)
  const needsToggle = slots.length > MAX_VISIBLE

  // Which slice to render: all slots, or the 9-slot window centred on selection
  const start = windowStart(slots, selectedSlotPk)
  const visibleSlots = showAll ? slots : slots.slice(start, start + MAX_VISIBLE)

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 mb-3">Select your preferred departure time</p>

      <div className="grid grid-cols-3 gap-2">
        {visibleSlots.map((slot) => {
          const isSelected = selectedSlotPk === slot.pk
          const isSoldOut = slot.capacity < 1
          const isChatToBook = !isSoldOut && slot.callToBook === true
          const capacityRatio = slot.capacity / maxCapacity
          const urgencyLabel = mode === 'shared' ? getCapacityLabel(slot.capacity) : null

          function handleClick() {
            if (isSoldOut) return
            if (isChatToBook) { trackWhatsAppClick('chat_to_book'); window.open(WHATSAPP_URL, '_blank'); return }
            onSelect(slot)
            // After picking a new time from the expanded list, collapse back to
            // the 9-slot window centred on the new selection.
            if (showAll) setShowAll(false)
          }

          const ariaLabel = isSoldOut
            ? `${slot.startTime} — sold out`
            : isChatToBook
              ? `${slot.startTime} — chat to book via WhatsApp`
              : isSelected
                ? `${slot.startTime} — selected`
                : `Select ${slot.startTime} departure`

          return (
            <button
              key={slot.pk}
              type="button"
              onClick={handleClick}
              disabled={isSoldOut}
              aria-label={ariaLabel}
              aria-pressed={isSelected}
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

              {isChatToBook && (
                <span className="block text-[10px] font-medium mt-0.5">Chat to book</span>
              )}

              {mode === 'shared' && !isSoldOut && !isChatToBook && !isSelected && (
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-zinc-100">
                  <div
                    className={`h-full ${getCapacityColor(capacityRatio)} rounded-full transition-all duration-500`}
                    style={{ width: `${capacityRatio * 100}%` }}
                  />
                </div>
              )}

              {urgencyLabel && !isChatToBook && !isSelected && (
                <span className="block text-[10px] font-medium text-amber-600 mt-0.5">
                  {urgencyLabel}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Show more / Show less toggle */}
      {needsToggle && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          aria-expanded={showAll}
          className="flex items-center gap-1 text-sm font-semibold text-[var(--color-primary)] hover:underline mt-1 border border-[var(--color-primary)] rounded-md px-3 py-1.5"
        >
          {showAll ? (
            <><ChevronUp className="w-4 h-4" /> Show less</>
          ) : (
            <><ChevronDown className="w-4 h-4" /> Show more</>
          )}
        </button>
      )}
    </div>
  )
}
