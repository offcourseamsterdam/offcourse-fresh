'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { X, UtensilsCrossed, ChevronDown } from 'lucide-react'
import { CancellationPolicyCard } from './CancellationPolicyCard'
import type { CancellationTier } from '@/lib/cancellation/policy'

export type ExtraItem = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  ingredients: string[] | null
  price_display: string
  min_people: number | null
  default_to_guest_count: boolean
}

interface ExtrasGridProps {
  foodExtras: ExtraItem[]
  drinkExtras: ExtraItem[]
  cancellationTiers: CancellationTier[] | null
}

export function ExtrasGrid({ foodExtras, drinkExtras, cancellationTiers }: ExtrasGridProps) {
  const [modalExtra, setModalExtra] = useState<ExtraItem | null>(null)
  const [extrasExpanded, setExtrasExpanded] = useState(false)

  // "Food cruise" listings (a buffet-style extra flagged default_to_guest_count —
  // see extras.default_to_guest_count) get a wider Food card that showcases the
  // standard menu with a photo + bullet list, plus the rest of the food extras as
  // a side "optional extras" list — instead of the plain name/price row list.
  // Everything else keeps the original Food | Drinks two-column layout unchanged.
  const featuredExtra = foodExtras.find((e) => e.default_to_guest_count) ?? null
  const otherFoodExtras = featuredExtra ? foodExtras.filter((e) => e.id !== featuredExtra.id) : foodExtras
  const isFoodCruiseLayout = !!featuredExtra

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Food column — wide (spans both columns) for a food-cruise listing */}
        {foodExtras.length > 0 && (
          <div className={`bg-white rounded-xl p-5 shadow-sm ${isFoodCruiseLayout ? 'sm:col-span-2' : ''}`}>
            <h3 className="font-avenir font-bold text-[18px] text-[var(--color-primary)] mb-4">
              Food
            </h3>
            {isFoodCruiseLayout && featuredExtra ? (
              <>
                {/* Photo on the left, the standard menu (what's included, bullet by
                    bullet) directly to its right — side by side, not stacked. */}
                <div className="flex flex-col sm:flex-row gap-6">
                  <div className="relative w-full sm:w-2/5 aspect-[4/3] rounded-lg overflow-hidden bg-zinc-100 flex-shrink-0">
                    {featuredExtra.image_url ? (
                      <Image
                        src={featuredExtra.image_url}
                        alt={featuredExtra.name}
                        fill
                        className="object-cover"
                        sizes="(min-width: 640px) 320px, 100vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-300">
                        <UtensilsCrossed className="w-10 h-10" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-semibold text-sm text-[var(--color-ink)]">{featuredExtra.name}</p>
                      <span className="text-sm font-semibold text-[var(--color-primary)] flex-shrink-0">
                        {featuredExtra.price_display}
                      </span>
                    </div>
                    {featuredExtra.min_people && featuredExtra.min_people > 0 && (
                      <p className="text-xs text-[var(--color-muted)] mt-0.5 mb-2">
                        Minimum {featuredExtra.min_people} people
                      </p>
                    )}
                    {featuredExtra.description && (
                      <p className="text-xs text-[var(--color-muted)] mt-1 mb-3">{featuredExtra.description}</p>
                    )}
                    {featuredExtra.ingredients && featuredExtra.ingredients.length > 0 && (
                      <ul className="space-y-1.5 mt-3">
                        {featuredExtra.ingredients.map((ingredient, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                            <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] flex-shrink-0" />
                            {ingredient}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Optional extras — always visible. The card grid is compact
                    enough (small square thumbnails, 3 columns) that hiding it
                    behind a click added friction without saving real space. */}
                {otherFoodExtras.length > 0 && (
                  <div className="mt-5 pt-5 border-t border-zinc-100">
                    <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-3">
                      Optional extras ({otherFoodExtras.length})
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {otherFoodExtras.map((extra) => (
                        <OptionalExtraCard key={extra.id} extra={extra} onClick={setModalExtra} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                {foodExtras.map((extra) => (
                  <ExtraCard key={extra.id} extra={extra} onClick={setModalExtra} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Drinks column */}
        {drinkExtras.length > 0 && (
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <h3 className="font-avenir font-bold text-[18px] text-[var(--color-primary)] mb-4">
              Drinks
            </h3>
            <div className="space-y-4">
              {drinkExtras.map((extra) => (
                <ExtraCard key={extra.id} extra={extra} onClick={setModalExtra} />
              ))}
            </div>
          </div>
        )}

        {/* Cancellation policy — spans both columns normally, but sits next to
            Drinks instead (narrower) when the Food card above has already
            claimed the wide row for the food-cruise layout. */}
        {cancellationTiers && cancellationTiers.length > 0 && (
          <CancellationPolicyCard tiers={cancellationTiers} wide={!isFoodCruiseLayout} />
        )}
      </div>

      {/* Detail modal */}
      {modalExtra && (
        <ExtraDetailModal extra={modalExtra} onClose={() => setModalExtra(null)} />
      )}
    </>
  )
}

function ExtraCard({
  extra,
  onClick,
}: {
  extra: ExtraItem
  onClick: (e: ExtraItem) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(extra)}
      className="w-full text-left flex gap-3 rounded-lg p-2 -m-2 transition-transform duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--color-sand)]/50 cursor-pointer"
    >
      {extra.image_url && (
        <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
          <Image
            src={extra.image_url}
            alt={extra.name}
            fill
            className="object-cover"
            sizes="64px"
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm text-[var(--color-ink)] min-w-0">
            <span className="font-semibold">{extra.name}</span>
            {extra.min_people && extra.min_people > 0 && (
              <span className="text-xs text-[var(--color-muted)] font-normal ml-1.5">
                · min. {extra.min_people} people
              </span>
            )}
          </p>
          <span className="text-sm font-semibold text-[var(--color-primary)] flex-shrink-0">
            {extra.price_display}
          </span>
        </div>
        {extra.description && (
          <p className="text-xs text-[var(--color-muted)] mt-0.5 line-clamp-2">
            {extra.description}
          </p>
        )}
        {extra.ingredients && extra.ingredients.length > 0 && (
          <p className="text-xs text-[var(--color-muted)] mt-1 line-clamp-1">
            {extra.ingredients.join(' · ')}
          </p>
        )}
      </div>
    </button>
  )
}

/** Grid-card variant used for the expanded "Optional extras" section — a real
 *  photo per item (falls back to the same placeholder icon as the featured
 *  photo), rather than the compact thumbnail-row style of ExtraCard. */
function OptionalExtraCard({
  extra,
  onClick,
}: {
  extra: ExtraItem
  onClick: (e: ExtraItem) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(extra)}
      className="text-left rounded-lg overflow-hidden border border-zinc-100 hover:border-[var(--color-primary)] transition-colors"
    >
      {/* No placeholder box when there's no photo yet — an empty gray square
          per item reads as "broken," not "coming soon." The upload path in
          admin still exists (extras image upload) — once a photo's uploaded,
          image_url is set and this slot appears automatically. */}
      {extra.image_url && (
        <div className="relative w-full aspect-square bg-zinc-100">
          <Image
            src={extra.image_url}
            alt={extra.name}
            fill
            className="object-cover"
            sizes="(min-width: 640px) 140px, 33vw"
          />
        </div>
      )}
      <div className="p-2">
        <p className="text-xs font-semibold text-[var(--color-ink)] truncate">{extra.name}</p>
        <p className="text-xs font-semibold text-[var(--color-primary)]">{extra.price_display}</p>
      </div>
    </button>
  )
}

function ExtraDetailModal({
  extra,
  onClose,
}: {
  extra: ExtraItem
  onClose: () => void
}) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Trigger slide-up animation on next frame
    requestAnimationFrame(() => setIsVisible(true))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClose() {
    setIsVisible(false)
    setTimeout(onClose, 250) // wait for slide-down animation
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-4"
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className={`absolute inset-0 bg-black/50 transition-opacity duration-250 ${isVisible ? 'opacity-100' : 'opacity-0'}`} />

      {/* Drawer content — slides up from bottom on mobile, centered modal on desktop */}
      <div
        className={`relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto transition-transform duration-250 ease-out ${
          isVisible ? 'translate-y-0' : 'translate-y-full'
        }`}
        onClick={(e) => e.stopPropagation()}
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
            <Image
              src={extra.image_url}
              alt={extra.name}
              fill
              className="object-cover"
              sizes="(min-width: 640px) 512px, 100vw"
            />
          </div>
        )}

        {/* Details */}
        <div className="p-6">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h3 className="font-palmore text-[22px] text-[var(--color-primary)]">
              {extra.name}
            </h3>
            <span className="text-lg font-bold text-[var(--color-primary)] flex-shrink-0">
              {extra.price_display}
            </span>
          </div>
          {extra.min_people && extra.min_people > 0 && (
            <p className="text-xs text-[var(--color-muted)] mb-3">
              Minimum {extra.min_people} people
            </p>
          )}

          {extra.description && (
            <p className="text-sm text-[var(--color-ink)] leading-relaxed mb-4">
              {extra.description}
            </p>
          )}

          {extra.ingredients && extra.ingredients.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wider mb-2">
                What&apos;s inside
              </p>
              <div className="flex flex-wrap gap-2">
                {extra.ingredients.map((ingredient, i) => (
                  <span
                    key={i}
                    className="text-xs bg-[var(--color-sand)] text-[var(--color-ink)] px-2.5 py-1 rounded-full"
                  >
                    {ingredient}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
