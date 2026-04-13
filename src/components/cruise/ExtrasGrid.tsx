'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'

export type ExtraItem = {
  id: string
  name: string
  description: string | null
  image_url: string | null
  ingredients: string[] | null
  price_display: string
}

interface ExtrasGridProps {
  foodExtras: ExtraItem[]
  drinkExtras: ExtraItem[]
  cancellationPolicy: string | null
}

export function ExtrasGrid({ foodExtras, drinkExtras, cancellationPolicy }: ExtrasGridProps) {
  const [modalExtra, setModalExtra] = useState<ExtraItem | null>(null)

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Food column */}
        {foodExtras.length > 0 && (
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <h3 className="font-avenir font-bold text-[18px] text-[var(--color-primary)] mb-4">
              Food
            </h3>
            <div className="space-y-4">
              {foodExtras.map((extra) => (
                <ExtraCard key={extra.id} extra={extra} onReadMore={setModalExtra} />
              ))}
            </div>
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
                <ExtraCard key={extra.id} extra={extra} onReadMore={setModalExtra} />
              ))}
            </div>
          </div>
        )}

        {/* Cancellation policy — spans both columns */}
        {cancellationPolicy && (
          <div className="bg-white rounded-xl p-5 shadow-sm sm:col-span-2">
            <h3 className="font-avenir font-bold text-[18px] text-[var(--color-primary)] mb-3">
              Cancellation Policy
            </h3>
            <p className="text-sm text-[var(--color-muted)] leading-relaxed whitespace-pre-line">
              {cancellationPolicy}
            </p>
          </div>
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
  onReadMore,
}: {
  extra: ExtraItem
  onReadMore: (e: ExtraItem) => void
}) {
  const hasLongText = (extra.description && extra.description.length > 80) ||
    (extra.ingredients && extra.ingredients.length > 3)

  return (
    <div className="flex gap-3">
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
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            {extra.name}
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
        {hasLongText && (
          <button
            type="button"
            onClick={() => onReadMore(extra)}
            className="text-xs text-[var(--color-primary)] font-semibold mt-1 hover:underline"
          >
            Read more
          </button>
        )}
      </div>
    </div>
  )
}

function ExtraDetailModal({
  extra,
  onClose,
}: {
  extra: ExtraItem
  onClose: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal content */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 shadow-sm hover:bg-white transition-colors text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Large image */}
        {extra.image_url && (
          <div className="relative w-full aspect-[4/3] rounded-t-2xl overflow-hidden">
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
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h3 className="font-palmore text-[22px] text-[var(--color-primary)]">
              {extra.name}
            </h3>
            <span className="text-lg font-bold text-[var(--color-primary)] flex-shrink-0">
              {extra.price_display}
            </span>
          </div>

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
