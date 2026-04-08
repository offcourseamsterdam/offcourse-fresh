'use client'

import { motion, AnimatePresence } from 'framer-motion'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

const CITY_TAX_PER_PERSON_CENTS = 260

interface PriceSummaryProps {
  basePriceCents: number
  guestCount: number
  extrasCalculation: ExtrasCalculation | null
  mode: 'private' | 'shared'
  /** For shared: per-ticket breakdown */
  ticketBreakdown?: { label: string; count: number; priceCents: number }[]
}

function fmtEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
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
  guestCount,
  extrasCalculation,
  mode,
  ticketBreakdown,
}: PriceSummaryProps) {
  const cityTaxCents = guestCount * CITY_TAX_PER_PERSON_CENTS

  // Calculate extras total from the calculation object
  const extrasTotalCents = extrasCalculation
    ? extrasCalculation.line_items.reduce((sum, li) => sum + li.amount_cents, 0)
    : 0

  const grandTotalCents = basePriceCents + extrasTotalCents + cityTaxCents

  // VAT is included in the total (9% for cruises)
  const vatCents = Math.round(grandTotalCents - grandTotalCents / 1.09)

  if (basePriceCents === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-t border-zinc-100 pt-4 mt-4 space-y-2"
    >
      {/* Base price */}
      {mode === 'private' ? (
        <Row label="Cruise" value={basePriceCents} />
      ) : (
        ticketBreakdown?.map(t => (
          <Row key={t.label} label={`${t.label} × ${t.count}`} value={t.count * t.priceCents} />
        ))
      )}

      {/* Extras line items */}
      {extrasCalculation?.line_items.map(li => (
        <Row key={li.extra_id} label={li.name} value={li.amount_cents} />
      ))}

      {/* City tax */}
      <Row
        label={`City tax · ${guestCount} × €2.60`}
        value={cityTaxCents}
        muted
      />

      {/* Divider + total */}
      <div className="border-t border-zinc-200 pt-2 mt-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-900">Total</span>
          <span className="text-sm font-bold text-zinc-900">
            <AnimatedPrice value={grandTotalCents} />
          </span>
        </div>
        <div className="text-[10px] text-zinc-400 text-right mt-0.5">
          incl. {fmtEuros(vatCents)} VAT (9%)
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
