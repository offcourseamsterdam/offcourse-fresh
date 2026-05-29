import Image from 'next/image'
import { Minus, Plus, Check } from 'lucide-react'
import { CATEGORY_EMOJI } from '@/lib/constants'
import { fmtEuros } from '@/lib/utils'
import { formatPriceLabel, isPerPersonPickExtra, type ApiExtra } from './ExtraCard'

interface ExtraListItemProps {
  extra: ApiExtra
  selected: boolean
  onToggle: (id: string) => void
  guestCount: number
  /** Adults among guests. Caps the counter when extra is adults_only. */
  adultCount?: number
  baseAmountCents: number
  durationMinutes?: number
  /** Current quantity (food counter mode) */
  quantity: number
  onQuantityChange: (id: string, qty: number) => void
  /** 'food' = +/- counter, 'drinks' = group toggle */
  mode: 'food' | 'drinks'
}

export function ExtraListItem({
  extra,
  selected,
  onToggle,
  guestCount,
  adultCount,
  baseAmountCents,
  durationMinutes,
  quantity,
  onQuantityChange,
  mode,
}: ExtraListItemProps) {
  const perPersonPick = isPerPersonPickExtra(extra)
  const minQty = perPersonPick ? (extra.min_people ?? 1) : (extra.min_quantity ?? 1)
  // adults_only items cap the counter at adult count; otherwise no upper cap.
  const adults = adultCount ?? guestCount
  const maxQty = (perPersonPick && extra.adults_only) ? adults : Number.POSITIVE_INFINITY
  const belowMinGuests = perPersonPick && (
    extra.adults_only
      ? adults < (extra.min_people ?? 1)
      : guestCount < (extra.min_people ?? 1)
  )

  // Base price label: rate-only for per-person-pick; otherwise the existing total label
  const priceLabel = formatPriceLabel(extra, guestCount, baseAmountCents, durationMinutes)
  const runningTotal = perPersonPick && quantity > 0
    ? fmtEuros(extra.price_value * quantity)
    : null

  function handleMinus(e: React.MouseEvent) {
    e.stopPropagation()
    if (quantity <= minQty) {
      onQuantityChange(extra.id, 0)
    } else {
      onQuantityChange(extra.id, quantity - 1)
    }
  }

  function handlePlus(e: React.MouseEvent) {
    e.stopPropagation()
    if (belowMinGuests) return
    if (quantity === 0) {
      onQuantityChange(extra.id, minQty)
    } else if (quantity < maxQty) {
      onQuantityChange(extra.id, quantity + 1)
    }
  }

  function handleToggle() {
    if (belowMinGuests) return
    onToggle(extra.id)
  }

  return (
    <div className={`flex items-center gap-3 py-2.5 ${belowMinGuests ? 'opacity-60' : ''}`}>
      {/* Thumbnail */}
      <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-100">
        {extra.image_url ? (
          <Image
            src={extra.image_url}
            alt={extra.name}
            fill
            className="object-cover"
            sizes="48px"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-lg">
            {mode === 'food' ? CATEGORY_EMOJI.food : CATEGORY_EMOJI.drinks}
          </div>
        )}
      </div>

      {/* Name + price */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-800 truncate">{extra.name}</p>
        <p className="text-xs font-medium text-[var(--color-primary)]">
          {runningTotal
            ? <>{runningTotal} <span className="text-zinc-400 font-normal">· {quantity} × {fmtEuros(extra.price_value)}</span></>
            : priceLabel}
        </p>
        {belowMinGuests && (
          <p className="text-xs text-amber-700 mt-0.5">
            Need at least {extra.min_people} {extra.adults_only ? 'adults' : 'guests'} on the boat
          </p>
        )}
        {perPersonPick && quantity === 0 && !belowMinGuests && (
          <p className="text-xs text-zinc-400 mt-0.5">Min. {extra.min_people} people</p>
        )}
        {perPersonPick && quantity > 0 && (
          <p className="text-xs text-zinc-400 mt-0.5">For how many people?</p>
        )}
      </div>

      {/* Counter (food) or Toggle (drinks) */}
      {mode === 'food' ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleMinus}
            disabled={quantity === 0}
            className="w-7 h-7 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="w-5 text-center text-sm font-semibold text-zinc-800 tabular-nums">
            {quantity}
          </span>
          <button
            type="button"
            onClick={handlePlus}
            disabled={belowMinGuests || quantity >= maxQty}
            className="w-7 h-7 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleToggle}
          disabled={belowMinGuests}
          className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            selected
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
              : 'border-zinc-300 bg-white hover:border-zinc-400'
          } ${belowMinGuests ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {selected && <Check className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  )
}
