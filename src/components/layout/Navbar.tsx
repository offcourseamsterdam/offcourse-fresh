'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { locales, localeNames, localeFlags, type Locale } from '@/lib/i18n/config'
import { useAuth } from '@/lib/auth/hooks'
import { getDashboardPath } from '@/lib/auth/types'
import { Logo } from '@/components/ui/Logo'
import { SearchBar } from '@/components/search/SearchBar'
import { categorizeListings } from '@/lib/utils'
import { useSearch } from '@/lib/search/SearchContext'

interface NavListing {
  id: string
  title: string
  slug: string
  category: string
}

interface NavbarProps {
  navListings?: NavListing[]
}

export function Navbar({ navListings = [] }: NavbarProps) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const { profile, isLoading, signOut } = useAuth()

  const [menuOpen, setMenuOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [cruisesOpen, setCruisesOpen] = useState(false)
  const [mobileCruisesOpen, setMobileCruisesOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const cruisesRef = useRef<HTMLDivElement>(null)
  const { heroSearchVisible, triggerNavbarSearch } = useSearch()
  const showNavSearch = !heroSearchVisible

  // Hide desktop nav links once user scrolls a little
  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 80) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (cruisesRef.current && !cruisesRef.current.contains(e.target as Node)) {
        setCruisesOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function switchLocale(next: Locale) {
    router.replace(pathname, { locale: next })
    setLangOpen(false)
  }

  const { private: privateListings, shared: sharedListings } = categorizeListings(navListings)

  // All nav links — used in both desktop dropdown and mobile menu
  const NavLinks = ({ onClose }: { onClose: () => void }) => (
    <>
      <div>
        <button
          onClick={() => setMobileCruisesOpen(o => !o)}
          className="w-full flex items-center justify-between py-2.5 font-avenir text-primary font-medium hover:text-accent transition-colors"
        >
          {t('cruises')}
          <svg className={`w-4 h-4 transition-transform ${mobileCruisesOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {mobileCruisesOpen && (
          <div className="pl-4 pb-2 space-y-0.5">
            {navListings.map(listing => (
              <Link key={listing.id} href={`/cruises/${listing.slug}`}
                className="block py-2 text-sm font-avenir text-muted hover:text-primary"
                onClick={onClose}>
                {listing.title}
              </Link>
            ))}
            <Link href="/cruises" className="block py-2 text-sm font-avenir font-bold text-primary"
              onClick={onClose}>
              Browse all →
            </Link>
          </div>
        )}
      </div>

      <Link href="/merch" className="block py-2.5 font-avenir text-primary font-medium hover:text-accent transition-colors"
        onClick={onClose}>{t('merch')}</Link>

      <Link href="/crew" className="block py-2.5 font-avenir text-primary font-medium hover:text-accent transition-colors"
        onClick={onClose}>{t('crew')}</Link>

      {/* Login — always in menu */}
      {!isLoading && (
        <div className="pt-3 mt-1 border-t border-[#e5e7eb]">
          {profile ? (
            <>
              <Link href={getDashboardPath(profile.role, locale) as string}
                className="block py-2.5 font-avenir text-primary font-medium hover:text-accent transition-colors"
                onClick={onClose}>
                My dashboard
              </Link>
              <button onClick={() => { onClose(); signOut() }}
                className="w-full text-left py-2.5 font-avenir text-primary font-medium hover:text-accent transition-colors">
                Sign out
              </button>
            </>
          ) : (
            <Link href={`/${locale}/login`}
              className="block py-2.5 font-avenir text-primary font-medium hover:text-accent transition-colors"
              onClick={onClose}>
              Log in
            </Link>
          )}
        </div>
      )}
    </>
  )

  return (
    <header className="fixed top-0 left-0 right-0 z-[9999] bg-white/95 backdrop-blur-sm transition-all duration-300">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-16 gap-4">

        {/* Logo — left */}
        <Link href="/" className="flex-shrink-0">
          <Logo />
        </Link>

        {/* Centre — nav links OR inline search bar */}
        <div className="flex-1 flex items-center justify-center">

          {/* Inline search bar — slides in when hero search exits viewport */}
          <div className={`
            hidden md:block w-full max-w-md
            transition-all duration-300 ease-out
            ${showNavSearch
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-3 pointer-events-none'}
          `}>
            <SearchBar
              onSearch={(date, guests) => {
                triggerNavbarSearch(date, guests)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          </div>


        </div> {/* end centre flex-1 */}

        {/* Right side: language + hamburger */}
        <div className="flex items-center gap-2">
          {/* Language switcher */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 text-sm text-muted hover:text-primary transition-colors px-2 py-1 rounded"
              aria-label={t('selectLanguage')}
            >
              <span>{localeFlags[locale as Locale]}</span>
              <span className="font-avenir text-xs uppercase">{locale}</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {langOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-[#e5e7eb] py-1 z-50">
                {locales.map((loc) => (
                  <button key={loc} onClick={() => switchLocale(loc)}
                    className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-sand transition-colors ${loc === locale ? 'font-bold text-primary' : 'text-ink'}`}>
                    <span>{localeFlags[loc]}</span>
                    <span className="font-avenir">{localeNames[loc]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Hamburger — always visible */}
          <button
            className="p-2 text-primary hover:text-accent transition-colors"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? t('closeMenu') : t('openMenu')}
          >
            {menuOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Slide-down menu panel */}
      {menuOpen && (
        <div className="border-t border-[#e5e7eb] bg-white/98 backdrop-blur-sm px-6 pb-5 pt-3 shadow-lg">
          <div className="max-w-sm mx-auto flex flex-col gap-0.5">
            <NavLinks onClose={() => setMenuOpen(false)} />

            {/* Language switcher in menu */}
            <div className="pt-3 mt-1 border-t border-[#e5e7eb] flex flex-wrap gap-2">
              {locales.map((loc) => (
                <button key={loc} onClick={() => { switchLocale(loc); setMenuOpen(false) }}
                  className={`text-sm px-2 py-1 rounded flex items-center gap-1 font-avenir ${loc === locale ? 'bg-primary text-white font-bold' : 'bg-sand text-primary'}`}>
                  <span>{localeFlags[loc]}</span>
                  <span className="uppercase">{loc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
