'use client'

import { useState, useMemo, useEffect } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface UpsellExtra {
  id: string
  name: string
  description: string | null
  image_url: string | null
  category: string
  price_type: string
  price_value: number
  vat_rate: number
  quantity_mode: string | null
  min_quantity: number | null
  min_people: number | null
  adults_only: boolean | null
  is_required: boolean | null
  ingredients: string[] | null
}

interface Props {
  bookingId: string
  token: string
  extras: UpsellExtra[]
  guestCount: number
  alreadyOrdered: boolean
  existingCatering: { name: string; quantity?: number; is_per_person_pick?: boolean }[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function categoryLabel(cat: string) {
  return cat === 'food' ? '🍽️ Food' : '🍹 Drinks'
}

// ── Item card ────────────────────────────────────────────────────────────────

function ExtraCard({
  extra,
  qty,
  guestCount,
  onToggle,
  onQty,
  onOpenModal,
}: {
  extra: UpsellExtra
  qty: number
  guestCount: number
  onToggle: () => void
  onQty: (n: number) => void
  onOpenModal: () => void
}) {
  const isCounter = extra.quantity_mode === 'counter'
  const minQty = extra.min_quantity ?? (extra.min_people ?? 1)
  const maxQty = extra.adults_only ? guestCount : guestCount * 2
  const selected = qty > 0
  const priceEuros = `€${(extra.price_value / 100).toFixed(0)}`
  const priceSuffix = extra.price_type === 'per_person_cents' ? ' p.p.'
    : extra.price_type === 'per_person_per_hour_cents' ? ' p.p./hr'
    : ''
  const priceLabel = priceEuros + priceSuffix

  return (
    <div
      className={`relative rounded-2xl overflow-hidden border-2 transition-all duration-200 ${
        selected
          ? 'border-[var(--color-primary)] shadow-lg'
          : 'border-transparent shadow-md'
      } bg-white`}
    >
      {/* Photo — clickable to open modal */}
      <button
        type="button"
        onClick={onOpenModal}
        className="relative block w-full h-32 sm:h-44 bg-[#f4f1ec] focus:outline-none"
      >
        {extra.image_url ? (
          <Image
            src={extra.image_url}
            alt={extra.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, 280px"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-4xl">
            {extra.category === 'food' ? '🍽️' : '🍹'}
          </div>
        )}

        {/* Price badge — always visible, turns indigo with checkmark when selected */}
        <div className="absolute top-2 right-2 z-10">
          <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 shadow-sm ${
            selected ? 'bg-[var(--color-primary)]' : 'bg-white/90 backdrop-blur-sm'
          }`}>
            {selected && (
              <svg className="w-3 h-3 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span className={`text-xs font-bold ${selected ? 'text-white' : 'text-[var(--color-primary)]'}`}>
              {priceLabel}
            </span>
          </div>
        </div>
      </button>

      {/* Info */}
      <div className="p-3">
        <button
          type="button"
          onClick={onOpenModal}
          className="w-full text-left mb-3 focus:outline-none"
        >
          <h3 className="font-semibold text-[var(--color-ink)] text-sm leading-snug lowercase">{extra.name}</h3>
          {extra.min_people && extra.min_people > 0 && (
            <p className="text-xs text-[var(--color-muted)] mt-0.5">min. {extra.min_people} people</p>
          )}
        </button>

        <div className="flex items-center justify-between gap-1">
          {isCounter ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={e => { e.stopPropagation(); const n = qty - 1; onQty(n < minQty ? 0 : n) }}
                className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors text-base font-bold"
              >
                −
              </button>
              <span className="w-6 text-center text-sm font-semibold text-[var(--color-ink)]">{qty}</span>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onQty(Math.min(maxQty, qty + 1)) }}
                className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors text-base font-bold"
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onToggle() }}
              className={`w-full text-xs font-semibold px-4 py-3 rounded-full border transition-colors min-h-[44px] ${
                selected
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                  : 'border-gray-200 text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white hover:border-[var(--color-primary)]'
              }`}
            >
              {selected ? 'Added ✓' : 'Add'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Detail modal (same pattern as cruise detail page) ────────────────────────

function ExtraDetailModal({
  extra,
  qty,
  guestCount,
  onToggle,
  onQty,
  onClose,
}: {
  extra: UpsellExtra
  qty: number
  guestCount: number
  onToggle: () => void
  onQty: (n: number) => void
  onClose: () => void
}) {
  const [isVisible, setIsVisible] = useState(false)
  const isCounter = extra.quantity_mode === 'counter'
  const minQty = extra.min_quantity ?? (extra.min_people ?? 1)
  const maxQty = extra.adults_only ? guestCount : guestCount * 2
  const selected = qty > 0

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => setIsVisible(true))
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClose() {
    setIsVisible(false)
    setTimeout(onClose, 250)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-4"
      onClick={handleClose}
    >
      <div className={`absolute inset-0 bg-black/50 transition-opacity duration-250 ${isVisible ? 'opacity-100' : 'opacity-0'}`} />

      <div
        className={`relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto transition-transform duration-250 ease-out ${
          isVisible ? 'translate-y-0' : 'translate-y-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-zinc-300" />
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 shadow-sm hover:bg-white transition-colors text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Large image */}
        {extra.image_url && (
          <div className="relative w-full aspect-[4/3] sm:rounded-t-2xl overflow-hidden">
            <Image src={extra.image_url} alt={extra.name} fill className="object-cover" sizes="(min-width: 640px) 512px, 100vw" />
          </div>
        )}

        {/* Details */}
        <div className="p-6">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h3 className="font-palmore text-[22px] text-[var(--color-primary)] lowercase">{extra.name}</h3>
            <span className="text-lg font-bold text-[var(--color-primary)] flex-shrink-0">
              {`€${(extra.price_value / 100).toFixed(0)}`}
            </span>
          </div>

          {extra.min_people && extra.min_people > 0 && (
            <p className="text-xs text-[var(--color-muted)] mb-3">Minimum {extra.min_people} people</p>
          )}

          {extra.description && (
            <p className="text-sm text-[var(--color-ink)] leading-relaxed mb-4">{extra.description}</p>
          )}

          {extra.ingredients && extra.ingredients.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-2">What&apos;s inside</p>
              <div className="flex flex-wrap gap-2">
                {extra.ingredients.map((ingredient, i) => (
                  <span key={i} className="text-xs bg-[var(--color-sand)] text-[var(--color-ink)] px-2.5 py-1 rounded-full">
                    {ingredient}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add / counter controls */}
          <div className="pt-4 border-t border-gray-100">
            {isCounter ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--color-ink)]">Quantity</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onQty(Math.max(0, qty - 1))}
                    className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors text-base font-bold"
                  >−</button>
                  <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                  <button
                    type="button"
                    onClick={() => onQty(Math.min(maxQty, qty + 1))}
                    className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors text-base font-bold"
                  >+</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onToggle}
                className={`w-full font-bold py-4 rounded-xl transition-colors ${
                  selected
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'border-2 border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white'
                }`}
              >
                {selected ? 'Added ✓ — tap to remove' : 'Add to pre-order'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Already ordered view ─────────────────────────────────────────────────────

function AlreadyOrdered({ items }: { items: { name: string; quantity?: number; is_per_person_pick?: boolean }[] }) {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-[var(--color-ink)] mb-2">Pre-order confirmed!</h2>
      <p className="text-sm text-[var(--color-muted)] mb-6">We'll have everything ready when you arrive. See you on the water!</p>
      <div className="inline-block bg-[#f4f1ec] rounded-xl px-6 py-4 text-left">
        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">Your order</p>
        {items.map((item, i) => (
          <p key={i} className="text-sm text-[var(--color-ink)]">
            {item.name}
            {item.is_per_person_pick ? ` — ${item.quantity} people` : item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : ''}
          </p>
        ))}
      </div>
      <p className="text-xs text-[var(--color-muted)] mt-4">💳 Pay on the day — no payment needed now.</p>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ExtrasUpsellClient({ bookingId, token, extras, guestCount, alreadyOrdered, existingCatering }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(alreadyOrdered)
  const [orderedItems, setOrderedItems] = useState(existingCatering)
  const [error, setError] = useState<string | null>(null)
  const [modalExtra, setModalExtra] = useState<UpsellExtra | null>(null)

  const setQty = (id: string, n: number) =>
    setQuantities(prev => n === 0 ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)) : { ...prev, [id]: n })

  const selectedCount = useMemo(() => Object.values(quantities).filter(q => q > 0).length, [quantities])

  const totalCents = useMemo(() => extras.reduce((sum, e) => {
    const qty = quantities[e.id] ?? 0
    if (qty === 0) return sum
    switch (e.price_type) {
      case 'fixed_cents': return sum + e.price_value * qty
      case 'per_person_cents': return sum + e.price_value * (e.min_people ? qty : guestCount)
      case 'per_person_per_hour_cents': return sum + e.price_value * guestCount
      default: return sum + e.price_value * qty
    }
  }, 0), [quantities, extras, guestCount])

  const food = extras.filter(e => e.category === 'food')
  const drinks = extras.filter(e => e.category === 'drinks' && e.price_type !== 'informational')
  const payPerDrinkInfo = extras.find(e => e.category === 'drinks' && e.price_type === 'informational')
  const drinkSelected = drinks.some(e => (quantities[e.id] ?? 0) > 0)

  async function handleSubmit() {
    const selections = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([extra_id, quantity]) => ({ extra_id, quantity }))

    if (!selections.length) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/booking/extras/${bookingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, selections }),
      })
      const json = await res.json()

      if (!json.ok) {
        setError(json.error ?? 'Something went wrong. Please try again.')
        return
      }

      // Show confirmed state
      const confirmedItems = extras
        .filter(e => quantities[e.id] > 0)
        .map(e => ({ name: e.name, quantity: quantities[e.id], is_per_person_pick: e.min_people != null }))
      setOrderedItems(confirmedItems)
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again or email us.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return <AlreadyOrdered items={orderedItems} />

  return (
    <div>
      {[
        { label: categoryLabel('food'), items: food },
        { label: categoryLabel('drinks'), items: drinks },
      ].filter(g => g.items.length > 0).map(group => (
        <section key={group.label} className="mb-10">
          <h2 className="text-lg font-bold text-[var(--color-ink)] mb-4">{group.label}</h2>
          <div className="grid grid-cols-2 gap-3">
            {group.items.map(extra => {
              const qty = quantities[extra.id] ?? 0
              const minQty = extra.min_quantity ?? (extra.min_people ?? 1)
              return (
                <ExtraCard
                  key={extra.id}
                  extra={extra}
                  qty={qty}
                  guestCount={guestCount}
                  onToggle={() => setQty(extra.id, qty > 0 ? 0 : 1)}
                  onQty={n => setQty(extra.id, n === 0 ? 0 : Math.max(minQty, n))}
                  onOpenModal={() => setModalExtra(extra)}
                />
              )
            })}
          </div>
          {group.label === categoryLabel('drinks') && payPerDrinkInfo && !drinkSelected && (
            <div className="flex items-start gap-2 mt-4 px-4 py-3 bg-[#f4f1ec] rounded-xl text-sm text-[var(--color-muted)]">
              <span className="flex-shrink-0">🍺</span>
              <span>Not pre-ordering drinks? A pay-per-drink bar is standard on your cruise — order what you like on the day.</span>
            </div>
          )}
        </section>
      ))}

      {extras.length === 0 && (
        <p className="text-center text-[var(--color-muted)] py-12">No extras available right now.</p>
      )}

      {modalExtra && (
        <ExtraDetailModal
          extra={modalExtra}
          qty={quantities[modalExtra.id] ?? 0}
          guestCount={guestCount}
          onToggle={() => setQty(modalExtra.id, (quantities[modalExtra.id] ?? 0) > 0 ? 0 : 1)}
          onQty={n => {
            const minQty = modalExtra.min_quantity ?? (modalExtra.min_people ?? 1)
            setQty(modalExtra.id, n === 0 ? 0 : Math.max(minQty, n))
          }}
          onClose={() => setModalExtra(null)}
        />
      )}

      {/* Sticky bottom bar */}
      {extras.length > 0 && (
        <div className="sticky bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] px-4 py-4 -mx-4 sm:-mx-0 sm:rounded-2xl sm:static sm:z-auto sm:shadow-none sm:border sm:border-gray-100 sm:mt-4 sm:px-6 sm:py-5">
          {error && (
            <p className="text-sm text-red-600 mb-3 text-center">{error}</p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={selectedCount === 0 || submitting}
            className="w-full bg-[var(--color-primary)] text-white font-bold text-base py-4 rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {submitting
              ? 'Confirming…'
              : selectedCount > 0
                ? `Confirm pre-order (${selectedCount} item${selectedCount === 1 ? '' : 's'} · €${(totalCents / 100).toFixed(0)}) — pay on the day`
                : 'Select items above'}
          </button>
          <p className="text-xs text-center text-[var(--color-muted)] mt-2">
            💳 No payment needed now — you settle on the day of your cruise
          </p>
        </div>
      )}
    </div>
  )
}
