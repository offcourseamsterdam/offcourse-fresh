import { CATEGORY_EMOJI } from '@/lib/constants'
import { ExtraCard, type ApiExtra } from './ExtraCard'

// ── Category labels ────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  food: 'Food',
  drinks: 'Drinks',
  protection: 'Protection',
  experience: 'Experiences',
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface ExtraCategoryGroupProps {
  category: string
  extras: ApiExtra[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  guestCount: number
  baseAmountCents: number
}

// ── Component ──────────────────────────────────────────────────────────────

export function ExtraCategoryGroup({
  category,
  extras,
  selectedIds,
  onToggle,
  guestCount,
  baseAmountCents,
}: ExtraCategoryGroupProps) {
  return (
    <div className="space-y-2">
      {/* Category header */}
      <div className="flex items-center gap-2">
        <span className="text-sm" aria-hidden>{CATEGORY_EMOJI[category] ?? '🎁'}</span>
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          {CATEGORY_LABEL[category] ?? category}
        </span>
        <div className="flex-1 h-px bg-zinc-100" />
      </div>

      {/* Extras in this category */}
      {extras.map(extra => (
        <ExtraCard
          key={extra.id}
          extra={extra}
          selected={selectedIds.has(extra.id)}
          onToggle={onToggle}
          guestCount={guestCount}
          baseAmountCents={baseAmountCents}
        />
      ))}
    </div>
  )
}
