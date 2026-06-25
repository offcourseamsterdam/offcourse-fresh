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
  /**
   * True when the slot already has at least one other booking (remaining
   * capacity < boat maximum). In this case the cruise is already "happening"
   * and we skip the minimum party size gate — a solo add-on is fine.
   */
  hasExistingBookings?: boolean
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
  hasExistingBookings = false,
}: TicketStepProps) {
  const totalTickets = Object.values(ticketCounts).reduce((sum, c) => sum + c, 0)

  // Derive the minimum party size from FareHarbor customer type data.
  // FareHarbor enforces this server-side — we mirror it in the UI so
  // the user knows before they try to proceed (avoids a paid booking
  // that can't be confirmed, which is what happened to Christine Hall).
  //
  // Exception: if the slot already has other bookings (hasExistingBookings),
  // the cruise is already "happening" — a solo add-on is fine and we skip the gate.
  const fhMinParty = Math.max(...customerTypes.map(ct => ct.minimumParty ?? 1), 1)
  const minParty = !hasExistingBookings ? Math.max(fhMinParty, 2) : fhMinParty
  const enforceMinParty = !hasExistingBookings && minParty > 1
  const belowMinimum = enforceMinParty && totalTickets > 0 && totalTickets < minParty

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

      {belowMinimum && (
        <p className="text-xs text-amber-700 font-medium pt-1">
          Please add at least {minParty - totalTickets} more ticket{minParty - totalTickets !== 1 ? 's' : ''} to continue.
        </p>
      )}

    </div>
  )
}
