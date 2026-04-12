'use client'

import { motion } from 'framer-motion'
import { Minus, Plus } from 'lucide-react'
import type { AvailabilityCustomerType } from '@/types'
import { fmtEuros } from '@/lib/utils'

const CITY_TAX_PER_PERSON_CENTS = 260 // €2.60

interface TicketStepProps {
  customerTypes: AvailabilityCustomerType[]
  ticketCounts: Record<number, number>
  maxCapacity: number
  onUpdateCount: (customerTypePk: number, count: number) => void
  onConfirm: () => void
}

// Try to derive a human label from customer type data
// FareHarbor customer types often have names like "Adult", "Child", etc.
function getCustomerTypeLabel(ct: AvailabilityCustomerType, index: number): string {
  // For now, use a simple mapping. When FH customer type names are available
  // from the API, these will be replaced.
  if (ct.minimumParty >= 18 || index === 0) return 'Adult'
  return 'Child'
}

export function TicketStep({
  customerTypes,
  ticketCounts,
  maxCapacity,
  onUpdateCount,
  onConfirm,
}: TicketStepProps) {
  const totalTickets = Object.values(ticketCounts).reduce((sum, c) => sum + c, 0)
  const subtotalCents = customerTypes.reduce(
    (sum, ct) => sum + (ticketCounts[ct.customerTypePk] || 0) * ct.priceCents,
    0
  )
  const cityTaxCents = totalTickets * CITY_TAX_PER_PERSON_CENTS

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 mb-1">Select your tickets</p>

      {customerTypes.map((ct, index) => {
        const count = ticketCounts[ct.customerTypePk] || 0
        const label = getCustomerTypeLabel(ct, index)
        const remaining = maxCapacity - totalTickets + count

        return (
          <motion.div
            key={ct.pk}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.25 }}
            className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3"
          >
            <div>
              <div className="text-sm font-semibold text-zinc-800">{label}</div>
              <div className="text-xs text-zinc-500">{fmtEuros(ct.priceCents)} per person</div>
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
          </motion.div>
        )
      })}

      {/* City tax line */}
      {totalTickets > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between px-4 py-2 text-xs text-zinc-500"
        >
          <span>City tax · {totalTickets} × €2.60</span>
          <span className="font-medium">{fmtEuros(cityTaxCents)}</span>
        </motion.div>
      )}

      {/* Confirm button */}
      {totalTickets > 0 && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <button
            type="button"
            onClick={onConfirm}
            className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Continue with {totalTickets} {totalTickets === 1 ? 'ticket' : 'tickets'}
          </button>
        </motion.div>
      )}
    </div>
  )
}
