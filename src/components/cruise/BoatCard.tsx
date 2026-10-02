'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { SnowCanvas } from './light-festival/SnowCanvas'

type PhotoTab = 'open' | 'covered' | 'interior'

interface BoatCardProps {
  name: string
  maxCapacity: number | null
  isElectric: boolean
  description: string | null
  photoUrl: string | null
  photoCoveredUrl: string | null
  photoInteriorUrl: string | null
  /** Full-width showcase layout: bigger photo, larger type, untruncated description. */
  large?: boolean
  /** Extra photos shown as a thumbnail row under the main photo (large layout). */
  gallery?: { url: string; alt: string }[]
  /** Callout under the description, e.g. "Dinner cruises: Curaçao only". */
  note?: { label: string; detail: string; linkLabel: string; href: string }
}

export function BoatCard({
  name,
  maxCapacity,
  isElectric,
  description,
  photoUrl,
  photoCoveredUrl,
  photoInteriorUrl,
  large = false,
  gallery = [],
  note,
}: BoatCardProps) {
  const tabs: { key: PhotoTab; label: string; url: string | null }[] = [
    { key: 'open', label: 'Open', url: photoUrl },
    { key: 'covered', label: 'Covered', url: photoCoveredUrl },
    { key: 'interior', label: 'Interior', url: photoInteriorUrl },
  ].filter((t) => t.url) as { key: PhotoTab; label: string; url: string }[]

  const [activeTab, setActiveTab] = useState<PhotoTab>(tabs[0]?.key ?? 'open')
  // A thumbnail pick overrides the tab photo until a tab is clicked again.
  const [galleryPick, setGalleryPick] = useState<{ url: string; alt: string } | null>(null)
  const activeUrl = galleryPick?.url ?? tabs.find((t) => t.key === activeTab)?.url ?? photoUrl

  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm">
      {/* Photo with tab switcher */}
      {activeUrl && (
        <div className={`relative w-full ${large ? 'aspect-[4/3] sm:aspect-[16/9]' : 'aspect-[16/10]'}`}>
          <Image
            src={activeUrl}
            alt={galleryPick?.alt ?? `${name} — ${activeTab}`}
            fill
            className="object-cover"
            sizes={large ? '(min-width: 1024px) 800px, 100vw' : '(min-width: 640px) 50vw, 100vw'}
          />

          {/* Light Festival cards: snow drifting over the photo (decorative, ignores clicks). */}
          {large && <SnowCanvas density={70} />}

          {/* Photo tab pills — only show if more than 1 photo */}
          {tabs.length > 1 && (
            <div className={`absolute left-3 flex gap-1 ${large ? 'bottom-4 sm:left-5 sm:bottom-5' : 'bottom-3'}`}>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setActiveTab(tab.key); setGalleryPick(null) }}
                  className={`rounded-full font-semibold transition-all ${large ? 'px-4 py-2 text-sm' : 'px-3 py-1 text-xs'} ${
                    activeTab === tab.key && !galleryPick
                      ? 'bg-white text-[var(--color-primary)] shadow-sm'
                      : 'bg-black/40 text-white hover:bg-black/60'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className={large ? 'p-5 sm:p-7' : 'p-4'}>
        <h3 className={`font-avenir font-bold text-[var(--color-primary)] ${large ? 'text-2xl sm:text-3xl' : 'text-lg'}`}>
          {name}
        </h3>
        <div className={`flex items-center gap-3 mt-1 text-[var(--color-muted)] ${large ? 'text-sm' : 'text-xs'}`}>
          {maxCapacity && <span>Up to {maxCapacity} guests</span>}
          {isElectric && <span>Electric</span>}
        </div>
        {description && (
          <p className={`text-[var(--color-ink)] mt-2 ${large ? 'text-base leading-relaxed sm:max-w-2xl' : 'text-sm line-clamp-3'}`}>
            {description}
          </p>
        )}

        {large && gallery.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide mt-5 -mx-1 px-1 pb-1" aria-label={`${name} photos`}>
            {gallery.map((photo) => (
              <button
                key={photo.url}
                type="button"
                onClick={() => setGalleryPick(photo)}
                aria-label={`Show photo: ${photo.alt}`}
                aria-pressed={galleryPick?.url === photo.url}
                className={`relative flex-shrink-0 w-24 h-[72px] sm:w-28 sm:h-20 rounded-lg overflow-hidden transition-all ${
                  galleryPick?.url === photo.url ? 'ring-2 ring-[var(--color-primary)] ring-offset-2' : 'opacity-85 hover:opacity-100'
                }`}
              >
                <Image src={photo.url} alt="" fill className="object-cover" sizes="112px" />
              </button>
            ))}
          </div>
        )}

        {note && (
          <div className="mt-5 rounded-xl bg-[var(--color-sand)] border border-zinc-200 p-4 flex gap-3 items-start">
            <span className="text-xl leading-none" aria-hidden="true">🍽️</span>
            <div>
              <p className="font-bold text-sm text-[var(--color-primary)]">{note.label}</p>
              <p className="text-sm text-[var(--color-ink)] mt-0.5">{note.detail}</p>
              <Link href={note.href} className="inline-block mt-2 text-sm font-semibold text-[var(--color-primary)] underline underline-offset-2">
                {note.linkLabel} →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
