'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { AvailabilitySlot } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface HomepageSearchResult {
  listingId: string
  slots: AvailabilitySlot[]
}

interface SearchContextValue {
  /** true when the hero search bar is scrolled into viewport */
  heroSearchVisible: boolean
  setHeroSearchVisible: (visible: boolean) => void
  /** Navbar calls this to trigger a search in HeroSection */
  triggerNavbarSearch: (date: string, guests: number) => void
  /** HeroSection registers its search handler here */
  registerSearchHandler: (handler: (date: string, guests: number) => void) => (() => void)
  /** Homepage inline search state */
  searchDate: string | null
  searchGuests: number
  searchLoading: boolean
  searchResults: HomepageSearchResult[]
  /** Trigger inline search on homepage — sets state, scrolls, fetches */
  triggerHomepageSearch: (date: string, guests: number) => void
}

// ── Provider ─────────────────────────────────────────────────────────────────

const SearchContext = createContext<SearchContextValue | null>(null)

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [heroSearchVisible, setHeroSearchVisible] = useState(true)
  const handlerRef = useRef<((date: string, guests: number) => void) | null>(null)

  // Homepage inline search state
  const [searchDate, setSearchDate] = useState<string | null>(null)
  const [searchGuests, setSearchGuests] = useState(2)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<HomepageSearchResult[]>([])

  const triggerNavbarSearch = useCallback((date: string, guests: number) => {
    handlerRef.current?.(date, guests)
  }, [])

  const registerSearchHandler = useCallback((handler: (date: string, guests: number) => void) => {
    handlerRef.current = handler
    return () => { handlerRef.current = null }
  }, [])

  const triggerHomepageSearch = useCallback(async (date: string, guests: number) => {
    setSearchDate(date)
    setSearchGuests(guests)
    setSearchLoading(true)
    setSearchResults([])

    // Scroll to results section
    setTimeout(() => {
      document.getElementById('cruise-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)

    try {
      const res = await fetch(`/api/search?date=${date}&guests=${guests}`)
      const json = await res.json()
      if (json.ok && json.data?.results) {
        setSearchResults(
          json.data.results.map((r: { listing: { id: string }; availableSlots: AvailabilitySlot[] }) => ({
            listingId: r.listing.id,
            slots: r.availableSlots,
          }))
        )
      }
    } catch {
      // Silently fail — cards just won't show slots
    } finally {
      setSearchLoading(false)
    }
  }, [])

  return (
    <SearchContext.Provider value={{
      heroSearchVisible,
      setHeroSearchVisible,
      triggerNavbarSearch,
      registerSearchHandler,
      searchDate,
      searchGuests,
      searchLoading,
      searchResults,
      triggerHomepageSearch,
    }}>
      {children}
    </SearchContext.Provider>
  )
}

export function useSearch() {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearch must be used within SearchProvider')
  return ctx
}
