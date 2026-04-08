'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'

interface SearchContextValue {
  /** true when the hero search bar is scrolled out of viewport */
  heroSearchVisible: boolean
  setHeroSearchVisible: (visible: boolean) => void
  /** Navbar calls this to trigger a search in HeroSection */
  triggerNavbarSearch: (date: string, guests: number) => void
  /** HeroSection registers its search handler here */
  registerSearchHandler: (handler: (date: string, guests: number) => void) => (() => void)
}

const SearchContext = createContext<SearchContextValue | null>(null)

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [heroSearchVisible, setHeroSearchVisible] = useState(true)
  const handlerRef = useRef<((date: string, guests: number) => void) | null>(null)

  const triggerNavbarSearch = useCallback((date: string, guests: number) => {
    handlerRef.current?.(date, guests)
  }, [])

  const registerSearchHandler = useCallback((handler: (date: string, guests: number) => void) => {
    handlerRef.current = handler
    return () => { handlerRef.current = null }
  }, [])

  return (
    <SearchContext.Provider value={{
      heroSearchVisible,
      setHeroSearchVisible,
      triggerNavbarSearch,
      registerSearchHandler,
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
