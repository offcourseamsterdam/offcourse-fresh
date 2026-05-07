'use client'

import { useState, useEffect } from 'react'
import { Loader2, X, UtensilsCrossed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtEuros } from '@/lib/utils'
import type { AdminExtraLineItem } from '@/lib/admin/types'

interface CatalogExtra {
  id: string
  name: string
  category: string
  price_type: string
  price_value: number
  vat_rate: number
  is_active: boolean
  image_url: string | null
  quantity_mode?: string | null
}

interface AddCateringModalProps {
  bookingId: string
  guestCount: number
  existingExtras: AdminExtraLineItem[]
  baseAmountCents: number | null
  onClose: () => void
  onSuccess: () => void
}

/** Compute the total amount for one catering extra at a given quantity. */
function calcItemAmount(extra: CatalogExtra, guestCount: number, qty: number): number {
  if (qty === 0) return 0
  let unitAmt = 0
  if (extra.price_type === 'fixed_cents') {
    unitAmt = extra.price_value
  } else if (extra.price_type === 'per_person_cents') {
    unitAmt = Math.round(extra.price_value * guestCount)
  } else if (extra.price_type === 'per_person_per_hour_cents') {
    // default 1.5 h — a reasonable admin estimate
    unitAmt = Math.round(extra.price_value * guestCount * 1.5)
  } else {
    unitAmt = extra.price_value
  }
  return unitAmt * qty
}

/** Back-calculate inclusive VAT. */
function extractVat(amountInclVat: number, rate: number): number {
  if (rate === 0) return 0
  return Math.round((amountInclVat * rate) / (100 + rate))
}

export function AddCateringModal({
  bookingId,
  guestCount,
  existingExtras,
  baseAmountCents,
  onClose,
  onSuccess,
}: AddCateringModalProps) {
  const [catalogItems, setCatalogItems] = useState<CatalogExtra[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/extras')
        const json = await res.json()
        const all: CatalogExtra[] = json.data?.extras ?? []
        const catering = all.filter(
          e => e.is_active && e.category === 'food',
        )
        setCatalogItems(catering)

        // Pre-populate from existing extras on the booking
        const initial: Record<string, number> = {}
        for (const catalogItem of catering) {
          const existing = existingExtras.find(
            x => x.extra_id === catalogItem.id ||
              (x.name === catalogItem.name && x.category === catalogItem.category),
          )
          if (existing) {
            initial[catalogItem.id] = existing.quantity ?? 1
          }
        }
        setQuantities(initial)
      } catch {
        setError('Failed to load catering options')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [existingExtras])

  function setQty(extraId: string, qty: number) {
    setQuantities(prev => ({ ...prev, [extraId]: Math.max(0, qty) }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // Keep all non-food extras unchanged (drinks stay on the booking as-is)
      const nonCatering = existingExtras.filter(e => e.category !== 'food')

      // Build new catering line items for anything with qty > 0
      const newCateringItems: AdminExtraLineItem[] = []
      for (const extra of catalogItems) {
        const qty = quantities[extra.id] ?? 0
        if (qty <= 0) continue
        const amount = calcItemAmount(extra, guestCount, qty)
        newCateringItems.push({
          name: extra.name,
          amount_cents: amount,
          category: extra.category,
          extra_id: extra.id,
          quantity: qty,
        })
      }

      const newExtras = [...nonCatering, ...newCateringItems]
      const extrasAmountCents = newExtras.reduce((sum, e) => sum + e.amount_cents, 0)

      // Recalculate VAT.
      // Non-catering items don't store their VAT rate, so approximate at 9%.
      // Catering items: use the actual rate from the catalogue.
      const nonCateringVat = extractVat(
        nonCatering.reduce((sum, e) => sum + e.amount_cents, 0),
        9,
      )
      const cateringVat = newCateringItems.reduce((sum, item) => {
        const catalogItem = catalogItems.find(e => e.id === item.extra_id)
        return sum + extractVat(item.amount_cents, catalogItem?.vat_rate ?? 9)
      }, 0)

      // total_vat = base_vat + extras_vat; base_vat is kept as-is (we only update extras_vat)
      const extrasVatAmountCents = nonCateringVat + cateringVat

      const res = await fetch(`/api/admin/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extras_selected: newExtras,
          extras_amount_cents: extrasAmountCents,
          extras_vat_amount_cents: extrasVatAmountCents,
        }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as Record<string, string>).error ?? 'Save failed')
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const selectedCount = Object.values(quantities).filter(q => q > 0).length
  const selectedTotal = catalogItems.reduce((sum, e) => {
    const qty = quantities[e.id] ?? 0
    return sum + calcItemAmount(e, guestCount, qty)
  }, 0)

  const categories = ['food'] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4 text-zinc-400" />
            <h2 className="text-base font-semibold text-zinc-900">Add / Edit Catering</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-10 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading catering options…
            </div>
          )}

          {!loading && catalogItems.length === 0 && (
            <p className="text-sm text-zinc-400 py-10 text-center">
              No active catering extras found.
            </p>
          )}

          {!loading && catalogItems.length > 0 && (
            <div className="space-y-5">
              {categories.map(cat => {
                const items = catalogItems.filter(e => e.category === cat)
                if (items.length === 0) return null
                return (
                  <div key={cat}>
                    <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-2 capitalize">
                      {cat}
                    </p>
                    <div className="space-y-2">
                      {items.map(extra => {
                        const qty = quantities[extra.id] ?? 0
                        const amount = calcItemAmount(extra, guestCount, qty)
                        const unitLabel = extra.price_type === 'per_person_cents'
                          ? `${fmtEuros(Math.round(extra.price_value * guestCount))} for ${guestCount} guests`
                          : fmtEuros(extra.price_value)

                        return (
                          <div
                            key={extra.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                              qty > 0
                                ? 'border-[var(--color-primary)]/30 bg-[var(--color-sand)]'
                                : 'border-zinc-100 bg-zinc-50'
                            }`}
                          >
                            {/* Thumbnail */}
                            {extra.image_url ? (
                              <img
                                src={extra.image_url}
                                alt={extra.name}
                                className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-zinc-200 flex items-center justify-center flex-shrink-0 text-lg">
                                {cat === 'food' ? '🍽️' : '🥂'}
                              </div>
                            )}

                            {/* Name + price */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-900 truncate">{extra.name}</p>
                              <p className="text-xs text-zinc-400">{unitLabel}</p>
                            </div>

                            {/* Quantity stepper */}
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => setQty(extra.id, qty - 1)}
                                disabled={qty === 0}
                                className="w-7 h-7 rounded-full border border-zinc-200 text-zinc-600 flex items-center justify-center hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
                              >
                                −
                              </button>
                              <span className="w-5 text-center text-sm font-semibold text-zinc-900 tabular-nums">
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => setQty(extra.id, qty + 1)}
                                className="w-7 h-7 rounded-full border border-zinc-200 text-zinc-600 flex items-center justify-center hover:bg-white transition-colors text-sm font-bold"
                              >
                                +
                              </button>
                            </div>

                            {/* Line total */}
                            <span
                              className={`text-sm font-semibold min-w-[3.5rem] text-right tabular-nums ${
                                amount > 0 ? 'text-zinc-900' : 'text-zinc-200'
                              }`}
                            >
                              {amount > 0 ? fmtEuros(amount) : '—'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="border-t border-zinc-100 px-5 py-4 space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {selectedCount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">
                {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
              </span>
              <span className="font-semibold text-zinc-900">
                Catering total: {fmtEuros(selectedTotal)}
              </span>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save catering order'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
