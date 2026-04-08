'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Ship, Users } from 'lucide-react'
import type { AvailabilityCustomerType } from '@/types'
import { BOATS } from '@/lib/fareharbor/config'

interface BoatDurationStepProps {
  customerTypes: AvailabilityCustomerType[]
  guests: number
  selectedCustomerTypePk: number | null
  onSelect: (customerType: AvailabilityCustomerType, boatId: string) => void
}

interface BoatOption {
  id: string
  name: string
  maxGuests: number
  tagline: string
  durations: AvailabilityCustomerType[]
  status: 'available' | 'sold_out' | 'too_many_guests'
}

const BOAT_TAGLINES: Record<string, string> = {
  diana: 'Intimate & cozy, up to 8 guests',
  curacao: 'Spacious & social, up to 12 guests',
}

function fmtPrice(cents: number): string {
  return `€${Math.round(cents / 100)}`
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}.${Math.round(m / 6)}h` // 90min = 1.5h
}

export function BoatDurationStep({
  customerTypes,
  guests,
  selectedCustomerTypePk,
  onSelect,
}: BoatDurationStepProps) {
  // Group customer types by boat
  // We use the maximumParty to infer boat: ≤8 = Diana, >8 = Curaçao
  // This works with the current config; when CUSTOMER_TYPES PKs are filled in config.ts,
  // we can use proper mapping instead
  const boats = useMemo<BoatOption[]>(() => {
    const boatMap = new Map<string, AvailabilityCustomerType[]>()

    for (const ct of customerTypes) {
      // Infer boat from max party size
      const boatId = ct.maximumParty <= 8 ? 'diana' : 'curacao'
      const existing = boatMap.get(boatId) || []
      existing.push(ct)
      boatMap.set(boatId, existing)
    }

    return BOATS
      .map(boat => {
        const durations = (boatMap.get(boat.id) || []).sort(
          (a, b) => a.durationMinutes - b.durationMinutes
        )

        let status: BoatOption['status'] = 'available'
        if (guests > boat.maxGuests) {
          status = 'too_many_guests'
        } else if (durations.length === 0 || durations.every(d => d.totalCapacity < 1)) {
          status = 'sold_out'
        }

        return {
          id: boat.id,
          name: boat.name,
          maxGuests: boat.maxGuests,
          tagline: BOAT_TAGLINES[boat.id] || '',
          durations: durations.filter(d => d.totalCapacity >= 1),
          status,
        }
      })
      // Don't show boats where group is too large
      .filter(b => b.status !== 'too_many_guests')
  }, [customerTypes, guests])

  if (boats.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-zinc-500">No boats available for your group size.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 mb-1">Choose your boat and duration</p>

      {boats.map((boat, index) => {
        const isSoldOut = boat.status === 'sold_out'
        const hasSelection = boat.durations.some(d => d.pk === selectedCustomerTypePk)

        return (
          <motion.div
            key={boat.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.3, ease: 'easeOut' }}
            className={`rounded-xl border-2 p-4 transition-all duration-200 ${
              isSoldOut
                ? 'border-zinc-100 bg-zinc-50 opacity-60'
                : hasSelection
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/[0.02] shadow-sm'
                  : 'border-zinc-200 hover:border-zinc-300'
            }`}
          >
            {/* Boat header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Ship className="w-4 h-4 text-[var(--color-primary)]" />
                <span className="font-semibold text-sm text-zinc-800">{boat.name}</span>
              </div>
              {isSoldOut ? (
                <span className="text-xs font-medium text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">
                  Sold out
                </span>
              ) : (
                <div className="flex items-center gap-1 text-xs text-zinc-500">
                  <Users className="w-3 h-3" />
                  <span>Max {boat.maxGuests}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-zinc-500 mb-3">{boat.tagline}</p>

            {/* Duration pills */}
            {!isSoldOut && (
              <div className="flex flex-wrap gap-2">
                {boat.durations.map(ct => {
                  const isActive = selectedCustomerTypePk === ct.pk
                  return (
                    <button
                      key={ct.pk}
                      type="button"
                      onClick={() => onSelect(ct, boat.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                        isActive
                          ? 'bg-[var(--color-primary)] text-white shadow-sm'
                          : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                      }`}
                    >
                      {fmtDuration(ct.durationMinutes)} · {fmtPrice(ct.priceCents)}
                    </button>
                  )
                })}
              </div>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}
