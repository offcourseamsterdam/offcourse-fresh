'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import type { AvailabilitySlot } from '@/types'
import { Loader2 } from 'lucide-react'
import { BOATS } from '@/lib/fareharbor/config'

interface TimeSlotStepProps {
  slots: AvailabilitySlot[]
  loading: boolean
  mode: 'private' | 'shared'
  guests: number
  selectedSlotPk: number | null
  onSelect: (slot: AvailabilitySlot) => void
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

const BOAT_NAMES: Record<string, string> = {
  diana: 'Diana',
  curacao: 'Curaçao',
}

/** For a slot, determine which boats have at least one available duration that fits the group */
function getBoatAvailability(slot: AvailabilitySlot, guests: number): { boatId: string; available: boolean }[] {
  const boats = new Map<string, boolean>()
  for (const ct of slot.customerTypes) {
    // Skip boats that can't fit this group
    const boatConfig = BOATS.find(b => b.id === ct.boatId)
    if (boatConfig && guests > boatConfig.maxGuests) continue

    const current = boats.get(ct.boatId) ?? false
    if (ct.totalCapacity >= 1) boats.set(ct.boatId, true)
    else if (!current) boats.set(ct.boatId, false)
  }
  // Sort: diana first, then curacao
  return Array.from(boats.entries())
    .sort(([a], [b]) => (a === 'diana' ? -1 : b === 'diana' ? 1 : 0))
    .map(([boatId, available]) => ({ boatId, available }))
}

export function TimeSlotStep({ slots, loading, mode, guests, selectedSlotPk, onSelect }: TimeSlotStepProps) {
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
        <p className="text-sm text-zinc-500">No available time slots for this date.</p>
        <p className="text-xs text-zinc-400 mt-1">Try another date?</p>
      </div>
    )
  }

  // Find max capacity across all slots for scaling the bars
  const maxCapacity = Math.max(...slots.map(s => s.capacity), 1)

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 mb-3">Select your preferred departure time</p>

      <div className="grid grid-cols-3 gap-2">
        {slots.map((slot, index) => {
          const isSelected = selectedSlotPk === slot.pk
          const isSoldOut = slot.capacity < 1
          const capacityRatio = slot.capacity / maxCapacity
          const urgencyLabel = mode === 'shared' ? getCapacityLabel(slot.capacity) : null
          const boatStatus = mode === 'private' ? getBoatAvailability(slot, guests) : null

          return (
            <motion.button
              key={slot.pk}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.25, ease: 'easeOut' }}
              onClick={() => !isSoldOut && onSelect(slot)}
              disabled={isSoldOut}
              className={`relative overflow-hidden rounded-xl border-2 py-2.5 px-3 text-sm font-semibold transition-all duration-200 ${
                isSoldOut
                  ? 'border-zinc-100 text-zinc-300 cursor-not-allowed line-through bg-zinc-50'
                  : isSelected
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white scale-[1.02] shadow-md'
                    : 'border-zinc-200 text-zinc-700 hover:border-[var(--color-primary)] hover:scale-[1.02] cursor-pointer'
              }`}
            >
              {slot.startTime}

              {/* Boat availability tags — private tours only */}
              {boatStatus && !isSoldOut && !isSelected && (
                <div className="flex items-center justify-center gap-1 mt-1">
                  {boatStatus.map(({ boatId, available }) => (
                    <span
                      key={boatId}
                      className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                        available
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-zinc-100 text-zinc-400 line-through'
                      }`}
                    >
                      {BOAT_NAMES[boatId] ?? boatId}
                    </span>
                  ))}
                </div>
              )}

              {/* Capacity bar — shared tours only */}
              {mode === 'shared' && !isSoldOut && !isSelected && (
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-zinc-100">
                  <motion.div
                    className={`h-full ${getCapacityColor(capacityRatio)} rounded-full`}
                    initial={{ width: 0 }}
                    animate={{ width: `${capacityRatio * 100}%` }}
                    transition={{ delay: index * 0.05 + 0.2, duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
              )}

              {/* Urgency label */}
              {urgencyLabel && !isSelected && (
                <span className="block text-[10px] font-medium text-amber-600 mt-0.5">
                  {urgencyLabel}
                </span>
              )}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
