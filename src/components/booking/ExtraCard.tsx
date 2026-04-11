import Image from 'next/image'
import type { Extra } from '@/lib/extras/calculate'

// ── Types ──────────────────────────────────────────────────────────────────

/** Extends the base Extra with optional image_url / description / ingredients from the API */
export interface ApiExtra extends Extra {
  image_url?: string | null
  description?: string | null
  ingredients?: string[] | null
  name: string
}

export interface ExtraCardProps {
  extra: ApiExtra
  selected: boolean
  onToggle: (id: string) => void
  guestCount: number
  baseAmountCents: number
  durationMinutes?: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}

export function formatPriceLabel(
  extra: ApiExtra,
  guestCount: number,
  baseAmountCents: number,
  durationMinutes: number = 90,
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
  durationMinutes = 90,
}: ExtraCardProps) {
  return (
    <button
      onClick={() => onToggle(extra.id)}
      className={`w-full text-left flex items-center gap-3 rounded-lg border px-4 py-3 transition-all ${
        selected
          ? 'border-zinc-900 bg-zinc-900 text-white'
          : 'border-zinc-200 bg-white hover:border-zinc-400'
      }`}
    >
      {/* Checkbox indicator */}
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
        selected
          ? 'border-white bg-white'
          : 'border-zinc-300 bg-transparent'
      }`}>
        {selected && (
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-900" />
        )}
      </div>

      {/* Optional thumbnail */}
      {extra.image_url && (
        <div className="relative w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-zinc-100">
          <Image
            src={extra.image_url}
            alt={extra.name}
            fill
            className="object-cover"
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
      </div>

      {/* Price + VAT */}
      <div className="flex-shrink-0 text-right">
        <p className={`text-sm font-semibold ${selected ? 'text-white' : 'text-zinc-900'}`}>
          {formatPriceLabel(extra, guestCount, baseAmountCents, durationMinutes)}
        </p>
        {extra.vat_rate > 0 && (
          <p className={`text-xs ${selected ? 'text-zinc-300' : 'text-zinc-400'}`}>
            {extra.vat_rate}% VAT
          </p>
        )}
      </div>
    </button>
  )
}
