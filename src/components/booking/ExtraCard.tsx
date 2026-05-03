import { OptimizedImage } from '@/components/ui/OptimizedImage'
import { Minus, Plus } from 'lucide-react'
import { fmtEuros } from '@/lib/utils'
import { DEFAULT_DURATION_MINUTES } from '@/lib/constants'
import type { Extra } from '@/lib/extras/calculate'

// ── Types ──────────────────────────────────────────────────────────────────

/** Extends the base Extra with optional image_url / description / ingredients from the API */
export interface ApiExtra extends Extra {
  image_url?: string | null
  description?: string | null
  ingredients?: string[] | null
  name: string
  quantity_mode?: string
  min_quantity?: number
}

export interface ExtraCardProps {
  extra: ApiExtra
  selected: boolean
  onToggle: (id: string) => void
  guestCount: number
  baseAmountCents: number
  durationMinutes?: number
  /** Current quantity for counter-mode extras */
  quantity?: number
  /** Called when +/- buttons change the quantity */
  onQuantityChange?: (id: string, qty: number) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function formatPriceLabel(
  extra: ApiExtra,
  guestCount: number,
  baseAmountCents: number,
  durationMinutes: number = DEFAULT_DURATION_MINUTES,
): string {
  if (extra.price_type === 'fixed_cents') {
    return fmtEuros(extra.price_value)
  }
  if (extra.price_type === 'per_person_cents') {
    return fmtEuros(extra.price_value * guestCount)
  }
  if (extra.price_type === 'per_person_per_hour_cents') {
    const hours = durationMinutes / 60
    return fmtEuros(Math.round(extra.price_value * guestCount * hours))
  }
  if (extra.price_type === 'percentage') {
    const approxCents = Math.round(baseAmountCents * extra.price_value / 100)
    return `${extra.price_value}% ≈ €${(approxCents / 100).toFixed(2)}`
  }
  return ''
}

// ── Component ──────────────────────────────────────────────────────────────

export function ExtraCard({
  extra,
  selected,
  onToggle,
  guestCount,
  baseAmountCents,
  durationMinutes = DEFAULT_DURATION_MINUTES,
  quantity = 0,
  onQuantityChange,
}: ExtraCardProps) {
  const isCounter = extra.quantity_mode === 'counter'
  const minQty = extra.min_quantity ?? 1

  function handleCardClick() {
    if (isCounter && onQuantityChange) {
      // Toggle between 0 and min_quantity
      onQuantityChange(extra.id, quantity > 0 ? 0 : minQty)
    } else {
      onToggle(extra.id)
    }
  }

  function handleMinus(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onQuantityChange) return
    if (quantity <= minQty) {
      // Below or at minimum → deselect (set to 0)
      onQuantityChange(extra.id, 0)
    } else {
      onQuantityChange(extra.id, quantity - 1)
    }
  }

  function handlePlus(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onQuantityChange) return
    if (quantity === 0) {
      // Jump to minimum
      onQuantityChange(extra.id, minQty)
    } else {
      onQuantityChange(extra.id, quantity + 1)
    }
  }

  return (
    <button
      onClick={handleCardClick}
      className={`w-full text-left rounded-lg border transition-all flex items-center gap-3 px-4 py-3 ${
        selected
          ? 'border-zinc-900 bg-zinc-900 text-white'
          : 'border-zinc-200 bg-white hover:border-zinc-400'
      }`}
    >
          {/* Checkbox indicator (toggle mode only) */}
          {!isCounter && (
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              selected
                ? 'border-white bg-white'
                : 'border-zinc-300 bg-transparent'
            }`}>
              {selected && (
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-900" />
              )}
            </div>
          )}

          {/* Optional thumbnail */}
          {extra.image_url && (
            <div className="relative w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-zinc-100">
              <OptimizedImage
                asset={null}
                fallbackUrl={extra.image_url}
                alt={extra.name}
                context="thumb"
                fill
                sizes="40px"
              />
            </div>
          )}

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium truncate ${selected ? 'text-white' : 'text-zinc-900'}`}>
              {extra.name}
            </p>
            {extra.description && (
              <p className={`text-xs mt-0.5 line-clamp-1 ${selected ? 'text-zinc-300' : 'text-zinc-400'}`}>
                {extra.description}
              </p>
            )}
            {extra.ingredients && extra.ingredients.length > 0 && (
              <p className={`text-xs mt-0.5 line-clamp-2 ${selected ? 'text-zinc-300' : 'text-zinc-400'}`}>
                {extra.ingredients.join(' · ')}
              </p>
            )}

            {/* Counter UI (counter mode only) */}
            {isCounter && selected && (
              <div className="flex items-center gap-3 mt-2" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={handleMinus}
                  className="w-7 h-7 rounded-full border border-white/30 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-sm font-bold w-6 text-center">{quantity}</span>
                <button
                  type="button"
                  onClick={handlePlus}
                  className="w-7 h-7 rounded-full border border-white/30 flex items-center justify-center hover:bg-white/10 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Price */}
          <div className="flex-shrink-0 text-right">
            <p className={`text-sm font-semibold ${selected ? 'text-white' : 'text-zinc-900'}`}>
              {formatPriceLabel(extra, guestCount, baseAmountCents, durationMinutes)}
            </p>
          </div>
    </button>
  )
}
