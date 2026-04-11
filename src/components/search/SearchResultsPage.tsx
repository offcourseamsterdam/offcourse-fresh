'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchResultCard } from '@/components/search/SearchResultCard'
import { DagdeelTabs } from '@/components/search/DagdeelTabs'
import { TypeChips, type CruiseTypeFilter } from '@/components/search/TypeChips'
import { filterSlotsByDagdeel, type Dagdeel } from '@/lib/search/dagdeel'
import { useRouter } from '@/i18n/navigation'
import type { SearchResult } from '@/types'
import type { Locale } from '@/lib/i18n/config'

// ── Gradient config per dagdeel ─────────────────────────────────────────────

const DAGDEEL_STYLES: Record<Dagdeel, { gradient: string; photo: string | null; textColor: string }> = {
  all:       { gradient: 'from-[#f5f0eb] to-white',           photo: null,                            textColor: 'text-primary' },
  morning:   { gradient: 'from-[#f5e6d3] to-[#fdf4e3]',      photo: '/images/search/morning.webp',   textColor: 'text-primary' },
  afternoon: { gradient: 'from-[#dbeafe] to-[#f0f9ff]',       photo: '/images/search/afternoon.webp', textColor: 'text-primary' },
  evening:   { gradient: 'from-[#1e293b] to-[#c2410c]/30',    photo: '/images/search/evening.webp',   textColor: 'text-white' },
}

// ── Props ───────────────────────────────────────────────────────────────────

interface SearchResultsPageProps {
  results: SearchResult[]
  date: string
  guests: number
  locale: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

// ── Component ───────────────────────────────────────────────────────────────

export function SearchResultsPage({ results, date, guests, locale }: SearchResultsPageProps) {
  const router = useRouter()
  const [activeDagdeel, setActiveDagdeel] = useState<Dagdeel>('all')
  const [activeType, setActiveType] = useState<CruiseTypeFilter>('all')

  // Navigate to new search params when user submits the search bar
  function handleSearch(newDate: string, newGuests: number) {
    router.push(`/search?date=${newDate}&guests=${newGuests}`)
  }

  // Client-side filtering: dagdeel + type
  const filteredResults = useMemo(() => {
    let filtered = results.map(result => {
      const filteredSlots = filterSlotsByDagdeel(result.availableSlots, activeDagdeel)
      return { ...result, availableSlots: filteredSlots }
    }).filter(result => result.availableSlots.length > 0)

    if (activeType !== 'all') {
      filtered = filtered.filter(result => result.listing.category === activeType)
    }

    return filtered
  }, [results, activeDagdeel, activeType])

  const style = DAGDEEL_STYLES[activeDagdeel]
  const formattedDate = formatDate(date)

  return (
    <div className={`relative min-h-screen bg-gradient-to-b ${style.gradient} transition-all duration-300`}>

      {/* Photo overlay — crossfade when a dagdeel with a photo is active */}
      {Object.entries(DAGDEEL_STYLES).map(([key, s]) =>
        s.photo ? (
          <div
            key={key}
            className={`absolute inset-0 transition-opacity duration-500 ${
              activeDagdeel === key ? 'opacity-20' : 'opacity-0'
            }`}
          >
            <Image
              src={s.photo}
              alt=""
              fill
              className="object-cover"
              priority={key === 'morning'}
            />
          </div>
        ) : null
      )}

      {/* Content — sits above the photo overlay */}
      <div className="relative z-10 mx-auto max-w-6xl px-4 pt-24 pb-16 sm:px-6">

        {/* Search bar in glassmorphism container */}
        <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-lg p-2 max-w-md mx-auto mb-8">
          <SearchBar
            onSearch={handleSearch}
            initialDate={date}
            initialGuests={guests}
          />
        </div>

        {/* Dagdeel tabs — centered */}
        <div className="flex justify-center mb-4">
          <DagdeelTabs active={activeDagdeel} onChange={setActiveDagdeel} />
        </div>

        {/* Type chips — centered */}
        <div className="flex justify-center mb-6">
          <TypeChips active={activeType} onChange={setActiveType} />
        </div>

        {/* Result count */}
        <p className={`text-center font-avenir text-sm mb-8 ${style.textColor} opacity-80`}>
          {filteredResults.length === 0
            ? `No cruises match your filters for ${formattedDate}`
            : `${filteredResults.length} ${filteredResults.length === 1 ? 'cruise' : 'cruises'} available on ${formattedDate}`}
        </p>

        {/* Listing cards grid */}
        {filteredResults.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredResults.map(result => (
              <SearchResultCard
                key={result.listing.slug}
                result={result}
                locale={locale as Locale}
                date={date}
                guests={guests}
              />
            ))}
          </div>
        ) : (
          /* Empty state */
          <div className="text-center py-16">
            <div className="text-5xl mb-4">
              {activeDagdeel === 'evening' ? '🌙' : '🚤'}
            </div>
            <h3 className={`font-avenir font-bold text-lg mb-2 ${style.textColor}`}>
              No cruises found
            </h3>
            <p className={`font-avenir text-sm ${style.textColor} opacity-70 max-w-sm mx-auto`}>
              Try a different time of day, or adjust your date and guest count above.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
