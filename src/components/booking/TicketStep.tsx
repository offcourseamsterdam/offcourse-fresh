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

// Try to derive a human label from customer type data
function getCustomerTypeLabel(ct: AvailabilityCustomerType, index: number): string {
  if (ct.name) return ct.name
  if (ct.minimumParty >= 18 || index === 0) return 'Adult'
  return 'Child'
}

/** Format duration as "1h30" or "2h" */
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}h${m.toString().padStart(2, '0')}`
}

export function TicketStep({
  customerTypes,
  ticketCounts,
  maxCapacity,
  onUpdateCount,
  onConfirm,
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
                {fmtEuros(ct.priceCents)} per person{ct.durationMinutes ? ` · ${formatDuration(ct.durationMinutes)}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onUpdateCount(ct.customerTypePk, Math.max(0, count - 1))}
                disabled={count <= 0}
                className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-6 text-center font-semibold text-zinc-800 tabular-nums">{count}</span>
              <button
                type="button"
                onClick={() => onUpdateCount(ct.customerTypePk, count + 1)}
                disabled={count >= remaining}
                className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )
      })}

    </div>
  )
}
