'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { fmtEuros } from '@/lib/utils'
import { vatSummaryText } from '@/lib/extras/format'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

interface PriceSummaryProps {
  basePriceCents: number
  extrasCalculation: ExtrasCalculation | null
  mode: 'private' | 'shared'
  /** For private: e.g. "Curaçao · 2h" */
  cruiseLabel?: string
  /** For shared: per-ticket breakdown */
  ticketBreakdown?: { label: string; count: number; priceCents: number }[]
  /** City tax in cents (€2.60/person, shared only) */
  cityTaxCents?: number
}

function AnimatedPrice({ value }: { value: number }) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={value}
        initial={{ y: -8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 8, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="inline-block tabular-nums"
      >
        {fmtEuros(value)}
      </motion.span>
    </AnimatePresence>
  )
}

export function PriceSummary({
  basePriceCents,
  extrasCalculation,
  mode,
  cruiseLabel,
  ticketBreakdown,
  cityTaxCents = 0,
}: PriceSummaryProps) {
  const extrasTotalCents = extrasCalculation?.extras_amount_cents ?? 0
  const grandTotalCents = basePriceCents + extrasTotalCents + cityTaxCents

  if (basePriceCents === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-t border-zinc-100 pt-4 mt-4 space-y-2"
    >
      {/* Base price — show boat + duration for private, ticket breakdown for shared */}
      {mode === 'private' ? (
        <Row label={cruiseLabel || 'Cruise'} value={basePriceCents} />
      ) : (
        ticketBreakdown?.map(t => (
          <Row key={t.label} label={`${t.label} × ${t.count}`} value={t.count * t.priceCents} />
        ))
      )}

      {/* City tax (shared only) */}
      {cityTaxCents > 0 && (
        <Row label="City tax" value={cityTaxCents} />
      )}

      {/* Extras line items */}
      {extrasCalculation?.line_items.map(li => (
        <Row key={li.extra_id} label={li.name} value={li.amount_cents} />
      ))}

      {/* Divider + total */}
      <div className="border-t border-zinc-200 pt-2 mt-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-900">Total</span>
          <span className="text-sm font-bold text-zinc-900">
            <AnimatedPrice value={grandTotalCents} />
          </span>
        </div>
        <div className="text-[10px] text-zinc-400 text-right mt-0.5">
          incl. {vatSummaryText(basePriceCents, extrasCalculation)}
        </div>
      </div>
    </motion.div>
  )
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-xs ${muted ? 'text-zinc-400' : 'text-zinc-600'}`}>
      <span>{label}</span>
      <span className="font-medium tabular-nums">
        <AnimatedPrice value={value} />
      </span>
    </div>
  )
}
