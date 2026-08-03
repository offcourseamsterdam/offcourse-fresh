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
  /** Adults among guests. Caps the counter when extra is adults_only. Falls back to guestCount. */
  adultCount?: number
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
  adultCount?: number,
): string {
  // adults_only extras (e.g. Unlimited Drinks — alcohol) advertise the adult-only
  // price so the headline matches what calculateExtras actually charges.
  const headcount = extra.adults_only ? (adultCount ?? guestCount) : guestCount
  if (extra.price_type === 'fixed_cents') {
    return fmtEuros(extra.price_value)
  }
  if (extra.price_type === 'per_person_cents') {
    // Per-person-pick item: show the per-person rate (customer picks people count)
    if (extra.min_people && extra.min_people > 0) {
      return `${fmtEuros(extra.price_value)} per person`
    }
    // Legacy: applies to all guests automatically (adults only when flagged)
    return fmtEuros(extra.price_value * headcount)
  }
  if (extra.price_type === 'per_person_per_hour_cents') {
    const hours = durationMinutes / 60
    return fmtEuros(Math.round(extra.price_value * headcount * hours))
  }
  if (extra.price_type === 'percentage') {
    const approxCents = Math.round(baseAmountCents * extra.price_value / 100)
    return `${extra.price_value}% ≈ €${(approxCents / 100).toFixed(2)}`
  }
  return ''
}

/** True when the per-person extra uses the "customer picks people count" UX. */
export function isPerPersonPickExtra(extra: ApiExtra): boolean {
  return extra.price_type === 'per_person_cents' && !!extra.min_people && extra.min_people > 0
}

// ── Component ──────────────────────────────────────────────────────────────

export function ExtraCard({
  extra,
  selected,
  onToggle,
  guestCount,
  adultCount,
  baseAmountCents,
  durationMinutes = DEFAULT_DURATION_MINUTES,
  quantity = 0,
  onQuantityChange,
}: ExtraCardProps) {
  const perPersonPick = isPerPersonPickExtra(extra)
  // Per-person-pick items are always counter-mode regardless of the catalog flag
  const isCounter = perPersonPick || extra.quantity_mode === 'counter'
  // Counter floor: min_people takes precedence (it represents people for per-person-pick items)
  const minQty = perPersonPick ? (extra.min_people ?? 1) : (extra.min_quantity ?? 1)
  // adults_only items cap the counter at adultCount (excludes children); otherwise no upper cap.
  const adults = adultCount ?? guestCount
  const maxQty = (perPersonPick && extra.adults_only) ? adults : Number.POSITIVE_INFINITY
  // Disabled when the boat doesn't have enough adults/guests to satisfy the minimum
  const belowMinGuests = perPersonPick && (
    extra.adults_only
      ? adults < (extra.min_people ?? 1)
      : guestCount < (extra.min_people ?? 1)
  )

  function handleCardClick() {
    if (belowMinGuests) return
    if (isCounter && onQuantityChange) {
      onQuantityChange(extra.id, quantity > 0 ? 0 : minQty)
    } else {
      onToggle(extra.id)
    }
  }

  function handleMinus(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onQuantityChange) return
    if (quantity <= minQty) {
      // At minimum → deselect
      onQuantityChange(extra.id, 0)
    } else {
      onQuantityChange(extra.id, quantity - 1)
    }
  }

  function handlePlus(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onQuantityChange) return
    if (quantity === 0) {
      onQuantityChange(extra.id, minQty)
    } else if (quantity < maxQty) {
      onQuantityChange(extra.id, quantity + 1)
    }
  }

  return (
    <button
      onClick={handleCardClick}
      disabled={belowMinGuests}
      className={`w-full text-left rounded-lg border transition-all flex items-center gap-3 px-4 py-3 ${
        belowMinGuests
          ? 'border-zinc-200 bg-zinc-50 text-zinc-400 cursor-not-allowed'
          : selected
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
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className={`text-sm font-medium truncate ${selected ? 'text-white' : 'text-zinc-900'}`}>
                {extra.name}
              </p>
              {extra.adults_only && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                  selected ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500'
                }`}>
                  adults only
                </span>
              )}
            </div>
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

            {/* Min-people hint when below threshold */}
            {belowMinGuests && (
              <p className="text-xs text-amber-700 mt-1">
                Need at least {extra.min_people} {extra.adults_only ? 'adults' : 'guests'} on the boat
              </p>
            )}

            {/* Per-person-pick hint when not selected */}
            {perPersonPick && !selected && !belowMinGuests && (
              <p className="text-xs text-zinc-400 mt-0.5">
                Min. {extra.min_people} people
              </p>
            )}

            {/* Counter UI (counter mode only) */}
            {isCounter && selected && (
              <div className="mt-2" onClick={e => e.stopPropagation()}>
                {perPersonPick && (
                  <p className="text-xs text-zinc-300 mb-1">For how many people?</p>
                )}
                <div className="flex items-center gap-3">
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
                    disabled={quantity >= maxQty}
                    className="w-7 h-7 rounded-full border border-white/30 flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Price */}
          <div className="flex-shrink-0 text-right">
            <p className={`text-sm font-semibold ${selected ? 'text-white' : 'text-zinc-900'}`}>
              {perPersonPick && selected
                ? fmtEuros(extra.price_value * quantity)
                : formatPriceLabel(extra, guestCount, baseAmountCents, durationMinutes, adults)}
            </p>
            {perPersonPick && selected && (
              <p className="text-xs text-zinc-300 mt-0.5">
                {quantity} × {fmtEuros(extra.price_value)}
              </p>
            )}
          </div>
    </button>
  )
}
