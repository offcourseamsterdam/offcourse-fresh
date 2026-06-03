'use client'

import { Minus, Plus } from 'lucide-react'
import type { AvailabilityCustomerType } from '@/types'
import { fmtEuros } from '@/lib/utils'

interface TicketStepProps {
  customerTypes: AvailabilityCustomerType[]
  ticketCounts: Record<number, number>
  maxCapacity: number
  onUpdateCount: (customerTypePk: number, count: number) => void
  onConfirm: () => void
}

// Try to derive a human label from customer type data.
// Prefer FH's actual name (e.g. "Adult (13+)" / "Child (0-12)") so the age range is visible.
function getCustomerTypeLabel(ct: AvailabilityCustomerType, index: number): string {
  if (ct.name) return ct.name
  if (ct.minimumParty >= 18 || index === 0) return 'Adult'
  return 'Child'
}

export function TicketStep({
  customerTypes,
  ticketCounts,
  maxCapacity,
  onUpdateCount,
  onConfirm: _onConfirm,
}: TicketStepProps) {
  const totalTickets = Object.values(ticketCounts).reduce((sum, c) => sum + c, 0)
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 mb-1">Select your tickets</p>

      {customerTypes.map((ct, index) => {
        const count = ticketCounts[ct.customerTypePk] || 0
        const label = getCustomerTypeLabel(ct, index)
        const remaining = maxCapacity - totalTickets + count

        return (
          <div
            key={ct.pk}
            className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3"
          >
            <div>
              <div className="text-sm font-semibold text-zinc-800">{label}</div>
              <div className="text-xs text-zinc-500">
                {fmtEuros(ct.priceCents)} per person
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onUpdateCount(ct.customerTypePk, Math.max(0, count - 1))}
                disabled={count <= 0}
                aria-label={`Remove one ${label} ticket`}
                className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Minus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span
                className="w-6 text-center font-semibold text-zinc-800 tabular-nums"
                aria-live="polite"
                aria-label={`${count} ${label} ticket${count !== 1 ? 's' : ''}`}
              >{count}</span>
              <button
                type="button"
                onClick={() => onUpdateCount(ct.customerTypePk, count + 1)}
                disabled={count >= remaining}
                aria-label={`Add one ${label} ticket`}
                className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )
      })}

    </div>
  )
}
