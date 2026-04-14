'use client'

import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'

interface GuestStepProps {
  initialGuests: number
  maxGuests?: number
  onConfirm: (guests: number) => void
}

export function GuestStep({ initialGuests, maxGuests = 12, onConfirm }: GuestStepProps) {
  const [guests, setGuests] = useState(initialGuests)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-800">Guests</div>
          <div className="text-xs text-zinc-500">How many people are coming?</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setGuests(g => Math.max(1, g - 1))}
            disabled={guests <= 1}
            className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="w-6 text-center font-semibold text-zinc-800 tabular-nums">{guests}</span>
          <button
            type="button"
            onClick={() => setGuests(g => Math.min(maxGuests, g + 1))}
            disabled={guests >= maxGuests}
            className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onConfirm(guests)}
        className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:bg-[var(--color-primary-dark)] transition-colors"
      >
        Search availability
      </button>
    </div>
  )
}
