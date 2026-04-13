'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import type { AvailabilityCustomerType } from '@/types'
import { BOATS } from '@/lib/fareharbor/config'
import { fmtEurosRounded } from '@/lib/utils'

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
  imageUrl: string
  durations: AvailabilityCustomerType[]
  status: 'available' | 'sold_out' | 'too_many_guests'
}

const BOAT_TAGLINES: Record<string, string> = {
  diana: 'intimate & cozy',
  curacao: 'spacious & social',
}

// Alternate texture backgrounds per boat
const BOAT_BG: Record<string, string> = {
  diana: 'bg-texture-yellow',
  curacao: 'bg-texture-pink',
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}.${Math.round(m / 6)}h`
}

export function BoatDurationStep({
  customerTypes,
  guests,
  selectedCustomerTypePk,
  onSelect,
}: BoatDurationStepProps) {
  const boats = useMemo<BoatOption[]>(() => {
    const boatMap = new Map<string, AvailabilityCustomerType[]>()

    for (const ct of customerTypes) {
      const existing = boatMap.get(ct.boatId) || []
      existing.push(ct)
      boatMap.set(ct.boatId, existing)
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
          imageUrl: boat.imageUrl,
          durations: durations.filter(d => d.totalCapacity >= 1),
          status,
        }
      })
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
        const bgClass = BOAT_BG[boat.id] ?? (index % 2 === 0 ? 'bg-texture-yellow' : 'bg-texture-sand')

        return (
          <motion.div
            key={boat.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.3, ease: 'easeOut' }}
            className={`rounded-xl overflow-hidden transition-all duration-200 ${
              isSoldOut ? 'opacity-50' : ''
            } ${
              hasSelection
                ? 'ring-2 ring-[var(--color-primary)] ring-offset-2'
                : ''
            }`}
          >
            <div className={`${bgClass} p-5`}>
              <div className="flex gap-4">
                {/* Text */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-briston text-[28px] text-[var(--color-primary)] uppercase leading-none">
                    {boat.name}
                  </h3>
                  <p className="font-palmore text-[16px] text-[var(--color-primary)]/70 mt-1">
                    {boat.tagline}
                  </p>
                  <p className="text-xs text-[var(--color-muted)] mt-1 font-avenir">
                    Up to {boat.maxGuests} guests
                  </p>
                </div>

                {/* Thumbnail */}
                <div className={`relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 shadow-sm ${isSoldOut ? 'grayscale' : ''}`}>
                  <Image
                    src={boat.imageUrl}
                    alt={boat.name}
                    fill
                    className="object-cover"
                    sizes="80px"
                  />
                </div>
              </div>

              {/* Sold out badge */}
              {isSoldOut && (
                <p className="text-sm font-semibold text-[var(--color-muted)] mt-3">
                  Sold out for this time
                </p>
              )}

              {/* Duration pills */}
              {!isSoldOut && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {boat.durations.map(ct => {
                    const isActive = selectedCustomerTypePk === ct.pk
                    return (
                      <button
                        key={ct.pk}
                        type="button"
                        onClick={() => onSelect(ct, boat.id)}
                        className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-150 ${
                          isActive
                            ? 'bg-[var(--color-primary)] text-white shadow-md'
                            : 'bg-white/80 text-[var(--color-primary)] hover:bg-white shadow-sm'
                        }`}
                      >
                        {fmtDuration(ct.durationMinutes)} · {fmtEurosRounded(ct.priceCents)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
