'use client'

import { motion, AnimatePresence } from 'framer-motion'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

interface PriceSummaryProps {
  basePriceCents: number
  guestCount: number
  extrasCalculation: ExtrasCalculation | null
  mode: 'private' | 'shared'
  /** For private: e.g. "Curaçao · 2h" */
  cruiseLabel?: string
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

function vatSummaryText(basePriceCents: number, extrasCalculation: ExtrasCalculation | null): string {
  // Build per-rate VAT groups
  const groups = new Map<number, number>()
  const baseVat = extrasCalculation?.base_vat_amount_cents ?? Math.round(basePriceCents * 9 / 109)
  if (baseVat > 0) groups.set(9, baseVat)
  for (const li of extrasCalculation?.line_items ?? []) {
    if (li.vat_rate > 0 && li.vat_amount_cents > 0) {
      groups.set(li.vat_rate, (groups.get(li.vat_rate) ?? 0) + li.vat_amount_cents)
    }
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, amount]) => `${fmtEuros(amount)} VAT (${rate}%)`)
    .join(' + ')
}

export function PriceSummary({
  basePriceCents,
  guestCount,
  extrasCalculation,
  mode,
  cruiseLabel,
  ticketBreakdown,
}: PriceSummaryProps) {
  // Extras total comes from the calculation (includes City Tax as a line item)
  const extrasTotalCents = extrasCalculation
    ? extrasCalculation.line_items.reduce((sum, li) => sum + li.amount_cents, 0)
    : 0

  const grandTotalCents = basePriceCents + extrasTotalCents

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

      {/* Extras line items (includes City Tax from the extras calculation) */}
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
