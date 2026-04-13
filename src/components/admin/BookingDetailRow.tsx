'use client'

import { BOOKING_SOURCES, EXTRAS_CATEGORIES } from '@/lib/constants'
import type { BookingSource } from '@/lib/constants'

// ── Types ──────────────────────────────────────────────────────────────────

interface ExtraLineItem {
  name: string
  amount_cents: number
  category?: string
}

interface BookingDetailRowProps {
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  guestNote: string | null
  baseAmountCents: number | null
  extrasAmountCents: number | null
  totalVatAmountCents: number | null
  stripeAmount: number | null
  depositAmountCents: number | null
  extrasSelected: ExtraLineItem[] | null
  bookingSource: string | null
  className?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtEur(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}

function sourceLabel(source: string | null) {
  if (!source) return 'Website'
  return BOOKING_SOURCES.find(s => s.value === source)?.label ?? source
}

function SourceBadge({ source }: { source: string | null }) {
  const isInternal = source && source !== 'website'
  if (!isInternal) return null
  const label = sourceLabel(source)
  const colorMap: Record<string, string> = {
    complimentary: 'bg-purple-100 text-purple-700',
    withlocals: 'bg-blue-100 text-blue-700',
    clickandboat: 'bg-sky-100 text-sky-700',
  }
  const color = colorMap[source] ?? 'bg-zinc-100 text-zinc-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export function BookingDetailRow({
  customerName,
  customerEmail,
  customerPhone,
  guestNote,
  baseAmountCents,
  extrasAmountCents,
  totalVatAmountCents,
  stripeAmount,
  depositAmountCents,
  extrasSelected,
  bookingSource,
  className = '',
}: BookingDetailRowProps) {
  const isInternal = bookingSource && bookingSource !== 'website'
  const extras = (extrasSelected ?? []) as ExtraLineItem[]

  // Group extras by category
  const byCategory = EXTRAS_CATEGORIES.reduce<Record<string, ExtraLineItem[]>>((acc, cat) => {
    const items = extras.filter(e => e.category === cat)
    if (items.length > 0) acc[cat] = items
    return acc
  }, {})
  // Items with no category go last
  const uncategorized = extras.filter(e => !e.category || !EXTRAS_CATEGORIES.includes(e.category as never))

  const grandTotal = isInternal
    ? depositAmountCents
    : stripeAmount

  return (
    <div className={`px-4 py-4 bg-zinc-50 border-t border-zinc-100 ${className}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

        {/* Guest info */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Guest</p>
          {customerName && <p className="text-sm font-medium text-zinc-900">{customerName}</p>}
          {customerEmail && <p className="text-sm text-zinc-500">{customerEmail}</p>}
          {customerPhone && <p className="text-sm text-zinc-500">{customerPhone}</p>}
          {guestNote && (
            <p className="text-sm text-zinc-400 italic mt-1">"{guestNote}"</p>
          )}
          {isInternal && (
            <div className="mt-2">
              <SourceBadge source={bookingSource} />
            </div>
          )}
        </div>

        {/* Extras by category */}
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Extras</p>
          {extras.length === 0 ? (
            <p className="text-sm text-zinc-400">No extras</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byCategory).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-xs text-zinc-400 capitalize mb-1">{cat}</p>
                  {items.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-zinc-700">{item.name}</span>
                      <span className={`font-medium ${isInternal ? 'text-zinc-400' : 'text-zinc-900'}`}>
                        {isInternal ? <span className="line-through text-zinc-300">{fmtEur(item.amount_cents)}</span> : fmtEur(item.amount_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {uncategorized.length > 0 && uncategorized.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-zinc-700">{item.name}</span>
                  <span className="font-medium text-zinc-900">{fmtEur(item.amount_cents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Price breakdown */}
        <div>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            {isInternal ? 'Deposit' : 'Price'}
          </p>
          <div className="space-y-1 text-sm">
            {!isInternal && (
              <>
                {baseAmountCents != null && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Base</span>
                    <span className="text-zinc-900">{fmtEur(baseAmountCents)}</span>
                  </div>
                )}
                {extrasAmountCents != null && extrasAmountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Extras</span>
                    <span className="text-zinc-900">{fmtEur(extrasAmountCents)}</span>
                  </div>
                )}
                {totalVatAmountCents != null && totalVatAmountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">VAT (incl.)</span>
                    <span className="text-zinc-500">{fmtEur(totalVatAmountCents)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-zinc-200 pt-1 mt-1">
                  <span className="text-zinc-900">Total charged</span>
                  <span className="text-zinc-900">{grandTotal != null ? fmtEur(grandTotal) : '—'}</span>
                </div>
              </>
            )}
            {isInternal && (
              <>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Platform deposit</span>
                  <span className="text-zinc-900 font-semibold">
                    {depositAmountCents != null ? fmtEur(depositAmountCents) : '€0'}
                  </span>
                </div>
                {baseAmountCents != null && (
                  <div className="flex justify-between text-zinc-400">
                    <span>Cruise value</span>
                    <span className="line-through">{fmtEur(baseAmountCents)}</span>
                  </div>
                )}
                <p className="text-xs text-zinc-400 mt-2">No Stripe charge — internal booking</p>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
