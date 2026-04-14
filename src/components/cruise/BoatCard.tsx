'use client'

import { useState } from 'react'
import Image from 'next/image'

type PhotoTab = 'open' | 'covered' | 'interior'

interface BoatCardProps {
  name: string
  maxCapacity: number | null
  isElectric: boolean
  description: string | null
  photoUrl: string | null
  photoCoveredUrl: string | null
  photoInteriorUrl: string | null
}

export function BoatCard({
  name,
  maxCapacity,
  isElectric,
  description,
  photoUrl,
  photoCoveredUrl,
  photoInteriorUrl,
}: BoatCardProps) {
  const tabs: { key: PhotoTab; label: string; url: string | null }[] = [
    { key: 'open', label: 'Open', url: photoUrl },
    { key: 'covered', label: 'Covered', url: photoCoveredUrl },
    { key: 'interior', label: 'Interior', url: photoInteriorUrl },
  ].filter((t) => t.url) as { key: PhotoTab; label: string; url: string }[]

  const [activeTab, setActiveTab] = useState<PhotoTab>(tabs[0]?.key ?? 'open')
  const activeUrl = tabs.find((t) => t.key === activeTab)?.url ?? photoUrl

  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm">
      {/* Photo with tab switcher */}
      {activeUrl && (
        <div className="relative w-full aspect-[16/10]">
          <Image
            src={activeUrl}
            alt={`${name} — ${activeTab}`}
            fill
            className="object-cover"
            sizes="(min-width: 640px) 50vw, 100vw"
          />

          {/* Photo tab pills — only show if more than 1 photo */}
          {tabs.length > 1 && (
            <div className="absolute bottom-3 left-3 flex gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    activeTab === tab.key
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
      <div className="p-4">
        <h3 className="font-avenir font-bold text-lg text-[var(--color-primary)]">
          {name}
        </h3>
        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-muted)]">
          {maxCapacity && <span>Up to {maxCapacity} guests</span>}
          {isElectric && <span>Electric</span>}
        </div>
        {description && (
          <p className="text-sm text-[var(--color-ink)] mt-2 line-clamp-3">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
