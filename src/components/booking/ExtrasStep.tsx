'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Lock, Loader2, ArrowLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { calculateExtras, type ExtrasCalculation } from '@/lib/extras/calculate'
import { CATEGORY_EMOJI } from '@/lib/constants'
import { ExtraCategoryGroup } from './ExtraCategoryGroup'
import { type ApiExtra, formatPriceLabel } from './ExtraCard'

// Optional extras rendered in this category order
const OPTIONAL_CATEGORY_ORDER = ['protection', 'food', 'drinks', 'experience']

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}

// ── Props ──────────────────────────────────────────────────────────────────

interface ExtrasStepProps {
  listingId: string
  listingTitle: string
  listingHeroImageUrl: string | null
  guestCount: number
  baseAmountCents: number
  onContinue: (
    selectedExtraIds: string[],
    calculation: ExtrasCalculation
  ) => void
  onBack?: () => void
}

// ── Component ──────────────────────────────────────────────────────────────

export function ExtrasStep({
  listingId,
  listingTitle,
  listingHeroImageUrl,
  guestCount,
  baseAmountCents,
  onContinue,
  onBack,
}: ExtrasStepProps) {
  const [extras, setExtras] = useState<ApiExtra[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [calculation, setCalculation] = useState<ExtrasCalculation | null>(null)

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

  // ── Recalculate whenever selection changes ───────────────────────────────

  useEffect(() => {
    if (!extras.length) return
    const allSelected = extras.filter(e =>
      e.is_required || (e.price_type !== 'informational' && selectedIds.has(e.id))
    )
    const calc = calculateExtras(baseAmountCents, guestCount, allSelected)
    setCalculation(calc)
  }, [selectedIds, extras, baseAmountCents, guestCount])

  // ── Derived sets ─────────────────────────────────────────────────────────

  const requiredExtras = extras.filter(e => e.is_required)
  const infoExtras = extras.filter(e => !e.is_required && e.price_type === 'informational')
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

  // ── Continue handler ─────────────────────────────────────────────────────

  function handleContinue() {
    if (!calculation) return
    const selectedExtraIds = extras
      .filter(e => e.is_required || (e.price_type !== 'informational' && selectedIds.has(e.id)))
      .map(e => e.id)
    onContinue(selectedExtraIds, calculation)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-2xl w-full">

      {/* ── Listing hero card ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {listingHeroImageUrl && (
          <div className="relative w-full h-36 sm:h-44 bg-zinc-100">
            <Image
              src={listingHeroImageUrl}
              alt={listingTitle}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, 672px"
            />
          </div>
        )}
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-base text-zinc-900">{listingTitle}</CardTitle>
        </CardHeader>
      </Card>

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-3 py-6 text-zinc-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading extras…
        </div>
      )}

      {/* ── Fetch error ───────────────────────────────────────────────────── */}
      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </div>
      )}

      {/* ── Required extras ───────────────────────────────────────────────── */}
      {!loading && requiredExtras.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider px-1">Included</p>
          {requiredExtras.map(extra => (
            <div
              key={extra.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-base flex-shrink-0" aria-hidden>
                  {CATEGORY_EMOJI[extra.category] ?? '📋'}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-700 truncate">{extra.name}</p>
                  {extra.description && (
                    <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{extra.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-semibold text-zinc-700">
                  {formatPriceLabel(extra, guestCount, baseAmountCents)}
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">
                  <Lock className="w-3 h-3" />
                  Included
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Informational cards ───────────────────────────────────────────── */}
      {!loading && infoExtras.length > 0 && (
        <div className="space-y-2">
          {infoExtras.map(extra => (
            <div
              key={extra.id}
              className="flex items-start gap-3 rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3"
            >
              <span className="text-base flex-shrink-0 mt-0.5" aria-hidden>ℹ️</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-600">{extra.name}</p>
                {extra.description && (
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{extra.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Optional extras grouped by category ──────────────────────────── */}
      {!loading && categoriesInOrder.length > 0 && (
        <div className="space-y-5">
          {categoriesInOrder.map(cat => (
            <ExtraCategoryGroup
              key={cat}
              category={cat}
              extras={grouped[cat]}
              selectedIds={selectedIds}
              onToggle={toggleExtra}
              guestCount={guestCount}
              baseAmountCents={baseAmountCents}
            />
          ))}
        </div>
      )}

      {/* ── Running total ────────────────────────────────────────────────── */}
      {!loading && calculation && (
        <Card className="bg-zinc-50 border-zinc-200">
          <CardContent className="pt-4 space-y-1.5 text-sm">
            {/* Base cruise */}
            <div className="flex justify-between text-zinc-600">
              <span>Cruise base</span>
              <span>{fmtEuros(calculation.base_amount_cents)}</span>
            </div>

            {/* Each extra line item */}
            {calculation.line_items.map(li => (
              <div key={li.extra_id} className="flex justify-between text-zinc-600">
                <span>{li.name}{li.guest_count ? ` (${li.guest_count} guests)` : ''}</span>
                <span>{fmtEuros(li.amount_cents)}</span>
              </div>
            ))}

            {/* Divider */}
            <div className="border-t border-zinc-200 my-1" />

            {/* Grand total */}
            <div className="flex justify-between font-bold text-zinc-900 text-base">
              <span>Total</span>
              <span>{fmtEuros(calculation.grand_total_cents)}</span>
            </div>

            {/* VAT footnote */}
            {calculation.total_vat_amount_cents > 0 && (
              <p className="text-xs text-zinc-400">
                incl. {fmtEuros(calculation.total_vat_amount_cents)} VAT
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Navigation buttons ────────────────────────────────────────────── */}
      {!loading && (
        <div className="flex items-center justify-between gap-3 pt-2">
          {onBack ? (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          ) : (
            <div />
          )}

          <Button
            onClick={handleContinue}
            disabled={!calculation}
            className="bg-zinc-900 hover:bg-zinc-700 min-w-44"
          >
            Continue to payment
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}
