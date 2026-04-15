'use client'

import { useState } from 'react'
import { CATEGORY_EMOJI } from '@/lib/constants'
import { ExtraCard, type ApiExtra } from './ExtraCard'
import { ExtraListItem } from './ExtraListItem'

// ── Category labels ────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  food: 'Food',
  drinks: 'Drinks',
  protection: 'Protection',
  experience: 'Experiences',
}

// ── Food sub-categories (derived from item name) ──────────────────────────

type FoodSubCategory = 'snackboxes' | 'platters' | 'meals' | 'other'

const FOOD_SUB_TABS: { key: FoodSubCategory; label: string }[] = [
  { key: 'snackboxes', label: 'Snackboxes' },
  { key: 'platters', label: 'Platters' },
  { key: 'meals', label: 'Meals' },
]

function getFoodSubCategory(name: string): FoodSubCategory {
  const lower = name.toLowerCase()
  if (lower.includes('bites box') || lower.includes('snack')) return 'snackboxes'
  if (lower.includes('platter') || lower.includes('charcuterie') || lower.includes('cheese') || lower.includes('fruit')) return 'platters'
  if (lower.includes('brunch') || lower.includes('lunch') || lower.includes('breakfast') || lower.includes('grazing')) return 'meals'
  return 'other'
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface ExtraCategoryGroupProps {
  category: string
  extras: ApiExtra[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  guestCount: number
  baseAmountCents: number
  durationMinutes?: number
  quantities: Map<string, number>
  onQuantityChange: (id: string, qty: number) => void
}

// ── Component ──────────────────────────────────────────────────────────────

export function ExtraCategoryGroup({
  category,
  extras,
  selectedIds,
  onToggle,
  guestCount,
  baseAmountCents,
  durationMinutes,
  quantities,
  onQuantityChange,
}: ExtraCategoryGroupProps) {
  const isFood = category === 'food'
  const isDrinks = category === 'drinks'

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

      {/* Food → sub-category tabs + list rows */}
      {isFood ? (
        <FoodWithTabs
          extras={extras}
          selectedIds={selectedIds}
          onToggle={onToggle}
          guestCount={guestCount}
          baseAmountCents={baseAmountCents}
          durationMinutes={durationMinutes}
          quantities={quantities}
          onQuantityChange={onQuantityChange}
        />
      ) : isDrinks ? (
        /* Drinks → list rows with toggle */
        <div className="divide-y divide-zinc-100">
          {extras.map(extra => (
            <ExtraListItem
              key={extra.id}
              extra={extra}
              selected={selectedIds.has(extra.id)}
              onToggle={onToggle}
              guestCount={guestCount}
              baseAmountCents={baseAmountCents}
              durationMinutes={durationMinutes}
              quantity={quantities.get(extra.id) ?? 0}
              onQuantityChange={onQuantityChange}
              mode="drinks"
            />
          ))}
        </div>
      ) : (
        /* Other categories → card layout */
        <div className="space-y-1.5">
          {extras.map(extra => (
            <ExtraCard
              key={extra.id}
              extra={extra}
              selected={selectedIds.has(extra.id)}
              onToggle={onToggle}
              guestCount={guestCount}
              baseAmountCents={baseAmountCents}
              durationMinutes={durationMinutes}
              quantity={quantities.get(extra.id) ?? 0}
              onQuantityChange={onQuantityChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Food with sub-category tabs ───────────────────────────────────────────

function FoodWithTabs({
  extras,
  selectedIds,
  onToggle,
  guestCount,
  baseAmountCents,
  durationMinutes,
  quantities,
  onQuantityChange,
}: Omit<ExtraCategoryGroupProps, 'category'>) {
  // Group food items by sub-category
  const grouped: Record<FoodSubCategory, ApiExtra[]> = {
    snackboxes: [],
    platters: [],
    meals: [],
    other: [],
  }
  for (const extra of extras) {
    const sub = getFoodSubCategory(extra.name)
    grouped[sub].push(extra)
  }

  // Only show tabs that have items
  const activeTabs = FOOD_SUB_TABS.filter(t => grouped[t.key].length > 0)
  // Add "other" tab if there are uncategorized items
  if (grouped.other.length > 0) {
    activeTabs.push({ key: 'other', label: 'Other' })
  }

  const [activeTab, setActiveTab] = useState<FoodSubCategory>(activeTabs[0]?.key ?? 'snackboxes')

  // If only 1 tab, don't show tabs — just show all items
  if (activeTabs.length <= 1) {
    return (
      <div className="divide-y divide-zinc-100">
        {extras.map(extra => (
          <ExtraListItem
            key={extra.id}
            extra={extra}
            selected={selectedIds.has(extra.id)}
            onToggle={onToggle}
            guestCount={guestCount}
            baseAmountCents={baseAmountCents}
            durationMinutes={durationMinutes}
            quantity={quantities.get(extra.id) ?? 0}
            onQuantityChange={onQuantityChange}
            mode="food"
          />
        ))}
      </div>
    )
  }

  const visibleExtras = grouped[activeTab] ?? []

  return (
    <div>
      {/* Sub-category pill tabs */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {activeTabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Items for active tab */}
      <div className="divide-y divide-zinc-100">
        {visibleExtras.map(extra => (
          <ExtraListItem
            key={extra.id}
            extra={extra}
            selected={selectedIds.has(extra.id)}
            onToggle={onToggle}
            guestCount={guestCount}
            baseAmountCents={baseAmountCents}
            durationMinutes={durationMinutes}
            quantity={quantities.get(extra.id) ?? 0}
            onQuantityChange={onQuantityChange}
            mode="food"
          />
        ))}
      </div>
    </div>
  )
}
