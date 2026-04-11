'use client'

import { useState } from 'react'
import { Loader2, ArrowLeft } from 'lucide-react'
import { ExtrasStep } from '@/components/booking/ExtrasStep'
import { ratePrice } from './helpers'
import type { ExtrasCalculation } from '@/lib/extras/calculate'
import type { Listing, Rate } from './types'

interface ExtrasStepPanelProps {
  listing: Listing
  rate: Rate
  guestCount: number
  creatingIntent: boolean
  intentError: string | null
  onContinue: (selectedExtraIds: string[], calculation: ExtrasCalculation) => void
  onBack: () => void
}

export function ExtrasStepPanel({
  listing,
  rate,
  guestCount,
  creatingIntent,
  intentError,
  onContinue,
  onBack,
}: ExtrasStepPanelProps) {
  const [pendingExtras, setPendingExtras] = useState<{
    ids: string[]
    calc: ExtrasCalculation
  } | null>(null)

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      {intentError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {intentError}
        </div>
      )}

      {creatingIntent && (
        <div className="flex items-center gap-3 py-4 text-zinc-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Preparing payment…
        </div>
      )}

      {!creatingIntent && (
        <>
          <ExtrasStep
            listingId={listing.id}
            guestCount={guestCount}
            baseAmountCents={ratePrice(rate) ?? 0}
            durationMinutes={rate.durationMinutes ?? 90}
            onExtrasChange={(ids, calc) => setPendingExtras({ ids, calc })}
          />
          <button
            type="button"
            onClick={() => pendingExtras && onContinue(pendingExtras.ids, pendingExtras.calc)}
            disabled={!pendingExtras}
            className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:bg-[var(--color-primary-dark)] transition-colors disabled:opacity-40"
          >
            Continue to payment
          </button>
        </>
      )}
    </div>
  )
}
