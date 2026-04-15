'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { calculateExtras, type ExtrasCalculation } from '@/lib/extras/calculate'
import { DEFAULT_DURATION_MINUTES } from '@/lib/constants'
import { ExtraCategoryGroup } from './ExtraCategoryGroup'
import { type ApiExtra } from './ExtraCard'

// Optional extras rendered in this category order
const OPTIONAL_CATEGORY_ORDER = ['protection', 'food', 'drinks', 'experience']

// Food and drinks are split into separate pages
const FOOD_CATEGORIES = ['food']
const DRINKS_CATEGORIES = ['drinks']
const OTHER_CATEGORIES = ['protection', 'experience']

// ── Props ──────────────────────────────────────────────────────────────────

interface ExtrasStepProps {
  listingId: string
  guestCount: number
  baseAmountCents: number
  /** Duration in minutes — used for per-person-per-hour pricing (e.g. unlimited drinks) */
  durationMinutes?: number
  onExtrasChange: (
    selectedExtraIds: string[],
    calculation: ExtrasCalculation
  ) => void
}

// ── Component ──────────────────────────────────────────────────────────────

export function ExtrasStep({
  listingId,
  guestCount,
  baseAmountCents,
  durationMinutes = DEFAULT_DURATION_MINUTES,
  onExtrasChange,
}: ExtrasStepProps) {
  const [extras, setExtras] = useState<ApiExtra[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map())
  const [page, setPage] = useState<'food' | 'drinks'>('food')

  // ── Fetch extras on mount ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFetchError(null)

    fetch(`/api/admin/cruise-listings/${listingId}/extras?guestCount=${guestCount}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return
        if (json.ok) {
          const fetched: ApiExtra[] = json.data?.extras ?? []
          setExtras(fetched)
          // Pre-select all required extras
          const required = new Set(
            fetched.filter(e => e.is_required).map(e => e.id)
          )
          setSelectedIds(required)
          // Initialize quantities for required counter-mode extras
          const initQty = new Map<string, number>()
          for (const e of fetched) {
            if (e.is_required && e.quantity_mode === 'counter') {
              initQty.set(e.id, e.min_quantity ?? 1)
            }
          }
          setQuantities(initQty)
        } else {
          setFetchError(json.error ?? 'Failed to load extras')
        }
      })
      .catch(() => {
        if (!cancelled) setFetchError('Network error — could not load extras')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [listingId, guestCount])

  // ── Recalculate and notify parent whenever selection/quantities change ───

  useEffect(() => {
    if (!extras.length) return
    const allSelected = extras.filter(e =>
      e.is_required || (e.price_type !== 'informational' && selectedIds.has(e.id))
    )
    const calc = calculateExtras(baseAmountCents, guestCount, allSelected, durationMinutes, quantities)
    onExtrasChange(allSelected.map(e => e.id), calc)
  }, [selectedIds, quantities, extras, baseAmountCents, guestCount, durationMinutes, onExtrasChange])

  // ── Derived sets ─────────────────────────────────────────────────────────

  const optionalExtras = extras.filter(e => !e.is_required && e.price_type !== 'informational')

  // Group optional extras by category
  const grouped: Record<string, ApiExtra[]> = {}
  for (const extra of optionalExtras) {
    const cat = extra.category ?? 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(extra)
  }

  // Categories in prescribed order, then any leftover
  const categoriesInOrder = [
    ...OPTIONAL_CATEGORY_ORDER.filter(c => grouped[c]?.length),
    ...Object.keys(grouped).filter(c => !OPTIONAL_CATEGORY_ORDER.includes(c) && grouped[c]?.length),
  ]

  // ── Toggle handler ───────────────────────────────────────────────────────

  function toggleExtra(id: string) {
    const extra = extras.find(e => e.id === id)
    if (extra?.quantity_mode === 'counter') {
      // For counter mode, toggle delegates to quantity change
      const currentQty = quantities.get(id) ?? 0
      handleQuantityChange(id, currentQty > 0 ? 0 : (extra.min_quantity ?? 1))
      return
    }
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // ── Quantity change handler ──────────────────────────────────────────────

  function handleQuantityChange(id: string, qty: number) {
    setQuantities(prev => {
      const next = new Map(prev)
      next.set(id, qty)
      return next
    })
    // Sync selectedIds based on quantity
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (qty > 0) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-6 text-zinc-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading extras…
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {fetchError}
      </div>
    )
  }

  if (categoriesInOrder.length === 0) {
    return (
      <p className="text-sm text-zinc-500 py-4">No optional extras available for this cruise.</p>
    )
  }

  // Split categories into food vs drinks+other pages
  const foodCats = categoriesInOrder.filter(c => FOOD_CATEGORIES.includes(c))
  const drinksCats = categoriesInOrder.filter(c => DRINKS_CATEGORIES.includes(c))
  const otherCats = categoriesInOrder.filter(c => OTHER_CATEGORIES.includes(c))

  // If no food items, skip straight to drinks page
  const hasFood = foodCats.length > 0
  const hasDrinks = drinksCats.length > 0 || otherCats.length > 0

  // Count selected food items for badge
  const selectedFoodCount = foodCats.flatMap(c => grouped[c] ?? []).filter(e => selectedIds.has(e.id)).length

  return (
    <div className="space-y-4">
      {/* Page indicator */}
      {hasFood && hasDrinks && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setPage('food')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              page === 'food'
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
            }`}
          >
            🍽️ Food
            {selectedFoodCount > 0 && page !== 'food' && (
              <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.5 rounded-full">{selectedFoodCount}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setPage('drinks')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              page === 'drinks'
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
            }`}
          >
            🥂 Drinks
          </button>
        </div>
      )}

      {/* FOOD page */}
      {(page === 'food' || !hasFood) && foodCats.map(cat => (
        <ExtraCategoryGroup
          key={cat}
          category={cat}
          extras={grouped[cat]}
          selectedIds={selectedIds}
          onToggle={toggleExtra}
          guestCount={guestCount}
          baseAmountCents={baseAmountCents}
          durationMinutes={durationMinutes}
          quantities={quantities}
          onQuantityChange={handleQuantityChange}
        />
      ))}

      {/* Food → Drinks "Next" button */}
      {page === 'food' && hasFood && hasDrinks && (
        <button
          type="button"
          onClick={() => setPage('drinks')}
          className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-bold text-sm hover:opacity-90 transition-opacity"
        >
          Next — Drinks
        </button>
      )}

      {/* DRINKS page */}
      {(page === 'drinks' || !hasFood) && (
        <div className="space-y-5">
          {drinksCats.map(cat => (
            <ExtraCategoryGroup
              key={cat}
              category={cat}
              extras={grouped[cat]}
              selectedIds={selectedIds}
              onToggle={toggleExtra}
              guestCount={guestCount}
              baseAmountCents={baseAmountCents}
              durationMinutes={durationMinutes}
              quantities={quantities}
              onQuantityChange={handleQuantityChange}
            />
          ))}
          {otherCats.map(cat => (
            <ExtraCategoryGroup
              key={cat}
              category={cat}
              extras={grouped[cat]}
              selectedIds={selectedIds}
              onToggle={toggleExtra}
              guestCount={guestCount}
              baseAmountCents={baseAmountCents}
              durationMinutes={durationMinutes}
              quantities={quantities}
              onQuantityChange={handleQuantityChange}
            />
          ))}
        </div>
      )}
    </div>
  )
}
