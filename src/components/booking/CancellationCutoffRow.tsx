'use client'

import { CancellationCutoff } from '@/components/checkout/CancellationCutoff'
import type { CancellationTier } from '@/lib/cancellation/policy'
import type { AvailabilitySlot } from '@/types'

interface CancellationCutoffRowProps {
  tiers: CancellationTier[] | null | undefined
  slot: AvailabilitySlot | null
}

/**
 * Centred soft-grey cutoff line shown under the "Proceed to booking" button
 * in both desktop sidebar and mobile slider booking panels. Renders nothing
 * when there's no useful upcoming deadline (e.g. inside the lowest tier or
 * no slot selected yet).
 */
export function CancellationCutoffRow({ tiers, slot }: CancellationCutoffRowProps) {
  if (!tiers || tiers.length === 0 || !slot?.startAt) return null
  return (
    <div className="text-center">
      <CancellationCutoff
        departureAt={new Date(slot.startAt)}
        tiers={tiers}
        bordered={false}
      />
    </div>
  )
}
