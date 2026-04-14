# Homepage Frontend Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Rebuild the Off Course Amsterdam homepage to pixel-perfect match the live site at offcourseamsterdam.com, using brand fonts (Briston, Palmore, Avenir Next), texture backgrounds, and the polaroid aesthetic — plus adding the search bar in the hero per the Next.js product plan.

**Architecture:** Reskin-over-reuse approach — keep all existing logic (search, FareHarbor, i18n, auth hooks) and replace only the visual JSX layer. Three new section components (Priorities, Fleet, Location) replace the current ReviewsSection + AboutSection on the homepage. All section backgrounds use texture PNGs downloaded from the live site's CDN.

**Tech Stack:** Next.js 14 App Router · Tailwind CSS v4 · TypeScript · `next-intl` · Framer Motion (available, use sparingly for polaroid hover) · Custom fonts via `@font-face`

---

## Reference: Live Site Design Tokens

These were extracted directly from offcourseamsterdam.com and must match exactly:

```
Fonts:
  H1/H2 display headings → Briston Regular (Briston_Regular.ttf)
  Subtitles/taglines      → Palmore Regular (Palmore Regular.ttf)
  Body / nav / cards      → Avenir Next (avenir_next_bold.ttf + avenir-next-light.ttf)

Colors:
  --color-primary: #343499   (indigo headings)
  --color-accent:  #990000   (crimson section headings + borders)
  --color-cta:     #9bb7fd   (lavender button fill)
  --color-yellow:  #fec201   (footer background)

Button (exact Tailwind classes from live site):
  bg-[#9bb7fd] text-[#990000] border-2 border-[#990000] rounded-full px-8 py-4
  hover:bg-[#990000] hover:text-[#9bb7fd] transition-all duration-300

Section textures (background-image: cover):
  Sand (Hero, Priorities, Location): public/textures/bg-sand.png
  Lavender (Cruises section):        public/textures/bg-lavender.png
  Purple (Fleet section):            public/textures/bg-purple.png
  Yellow (Footer):                   public/textures/bg-yellow.png
```

---

## Task 1: Copy Font Files

**Files:**
- Create: `public/fonts/Briston_Regular.ttf`
- Create: `public/fonts/Palmore_Regular.ttf`
- Create: `public/fonts/AvenirNext_Bold.ttf`
- Create: `public/fonts/AvenirNext_Light.ttf`

**Step 1: Copy fonts from Downloads to public/fonts/**

```bash
cp ~/Downloads/Briston_Regular.ttf "public/fonts/Briston_Regular.ttf"
cp ~/Downloads/"Palmore Regular.ttf" "public/fonts/Palmore_Regular.ttf"
cp ~/Downloads/avenir_next_bold.ttf "public/fonts/AvenirNext_Bold.ttf"
cp ~/Downloads/avenir-next-light.ttf "public/fonts/AvenirNext_Light.ttf"
```

**Step 2: Verify files exist and are non-empty**

```bash
ls -lh public/fonts/
```
Expected: 4 files, each > 10KB

**Step 3: Commit**

```bash
git add public/fonts/
git commit -m "feat: add brand fonts (Briston, Palmore, Avenir Next)"
```

---

## Task 2: Download Texture Background Images

**Files:**
- Create: `public/textures/bg-sand.png`
- Create: `public/textures/bg-lavender.png`
- Create: `public/textures/bg-purple.png`
- Create: `public/textures/bg-yellow.png`

**Step 1: Create textures directory and download all 4 PNGs**

```bash
mkdir -p public/textures

curl -L "https://offcourseamsterdam.com/lovable-uploads/6b43ae89-9723-46f5-995c-9a12827552f2.png" \
  -o public/textures/bg-sand.png

curl -L "https://offcourseamsterdam.com/lovable-uploads/8f0b8586-1226-4744-8ff8-701228e676b4.png" \
  -o public/textures/bg-lavender.png

curl -L "https://offcourseamsterdam.com/lovable-uploads/81c69495-982a-4d68-aeb6-486350fe74f7.png" \
  -o public/textures/bg-purple.png

curl -L "https://offcourseamsterdam.com/lovable-uploads/530c5403-d716-41a0-8d62-1645e4761783.png" \
  -o public/textures/bg-yellow.png
```

**Step 2: Verify downloads**

```bash
ls -lh public/textures/
```
Expected: 4 PNG files, each > 50KB

**Step 3: Commit**

```bash
git add public/textures/
git commit -m "feat: add section background textures"
```

---

## Task 3: Update globals.css (Fonts + Colors + Utilities)

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Replace the entire globals.css with the new version**

The new `src/app/globals.css`:

```css
@import "tailwindcss";

/* ── Custom Fonts ──────────────────────────────────── */
@font-face {
  font-family: 'Briston_Regular';
  src: url('/fonts/Briston_Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Palmore_Regular';
  src: url('/fonts/Palmore_Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Avenir_Next';
  src: url('/fonts/AvenirNext_Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Avenir_Next';
  src: url('/fonts/AvenirNext_Light.ttf') format('truetype');
  font-weight: 300;
  font-style: normal;
  font-display: swap;
}

@theme {
  /* ── Brand Colors ─────────────────────────────────── */
  --color-primary:       #343499;   /* indigo — all headings */
  --color-primary-light: #4444bb;
  --color-primary-dark:  #242480;

  --color-accent:        #990000;   /* crimson — section titles + borders */
  --color-accent-light:  #cc0000;
  --color-accent-dark:   #660000;

  --color-cta:           #9bb7fd;   /* lavender — button fill */
  --color-yellow:        #fec201;   /* ochre — footer bg */

  --color-lavender:      #b8a9c9;
  --color-lime:          #a8d65a;
  --color-pink:          #f4829a;

  --color-sand:          #f5f0e8;   /* warm off-white (fallback) */
  --color-ink:           #1f2937;   /* body text */
  --color-muted:         #6b7280;
  --color-border:        #e5e7eb;

  /* ── Typography ───────────────────────────────────── */
  --font-sans:    'Avenir_Next', ui-sans-serif, system-ui, sans-serif;
  --font-display: 'Briston_Regular', Georgia, serif;
  --font-accent:  'Palmore_Regular', Georgia, serif;

  /* ── Spacing ──────────────────────────────────────── */
  --spacing-section: 5rem;

  /* ── Border radius ────────────────────────────────── */
  --radius-card: 1rem;
  --radius-btn:  9999px;
}

/* ── Base styles ───────────────────────────────────── */
@layer base {
  html {
    color: var(--color-ink);
    background-color: var(--color-sand);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  body {
    font-family: var(--font-sans);
    font-weight: 300;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: 0.01em;
  }
}

/* ── Utilities ─────────────────────────────────────── */
@layer utilities {
  /* Polaroid card frame */
  .polaroid {
    background: white;
    padding: 0.75rem 0.75rem 2.5rem;
    box-shadow: 4px 4px 16px rgba(0, 0, 0, 0.15);
  }

  .polaroid:nth-child(even) {
    transform: rotate(1.5deg);
  }

  /* Polaroid shadow used in grid cards */
  .shadow-polaroid {
    box-shadow: 4px 4px 16px rgba(0, 0, 0, 0.15);
  }

  /* Section texture backgrounds */
  .bg-texture-sand {
    background-image: url('/textures/bg-sand.png');
    background-size: cover;
    background-position: center;
  }

  .bg-texture-lavender {
    background-image: url('/textures/bg-lavender.png');
    background-size: cover;
    background-position: center;
  }

  .bg-texture-purple {
    background-image: url('/textures/bg-purple.png');
    background-size: cover;
    background-position: center;
  }

  .bg-texture-yellow {
    background-image: url('/textures/bg-yellow.png');
    background-size: cover;
    background-position: center;
  }

  /* Brand CTA button */
  .btn-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1rem 2rem;
    background-color: #9bb7fd;
    color: #990000;
    border: 2px solid #990000;
    border-radius: 9999px;
    font-family: var(--font-accent);
    font-size: 1.125rem;
    transition: all 0.3s;
    cursor: pointer;
  }

  .btn-cta:hover {
    background-color: #990000;
    color: #9bb7fd;
  }

  /* Font shorthand utilities */
  .font-briston {
    font-family: 'Briston_Regular', Georgia, serif;
  }

  .font-palmore {
    font-family: 'Palmore_Regular', Georgia, serif;
  }

  .font-avenir {
    font-family: 'Avenir_Next', ui-sans-serif, system-ui, sans-serif;
  }
}
```

**Step 2: Run dev server and verify fonts load**

```bash
npm run dev
```
Open http://localhost:3000 — you should see the page render (even if not styled yet). Check browser dev tools → Network tab → filter "font" → should see 4 font files loading.

**Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: brand fonts, color tokens, texture bg utilities"
```

---

## Task 4: Redesign Navbar

**Files:**
- Modify: `src/components/layout/Navbar.tsx`

**Step 1: Replace the Navbar visual layer**

Key changes from the current version:
- Logo: use an inline SVG arch/gate icon + "OFFCOURSE" in Briston + "YOUR FRIEND WITH A BOAT" subtitle
- `Book Now` button: change to `.btn-cta` style (lavender + crimson border, pill shape)
- Remove `border-b` from header
- Nav links stay lowercase (already using i18n keys)

Replace the full content of `src/components/layout/Navbar.tsx`:

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { locales, localeNames, localeFlags, type Locale } from '@/lib/i18n/config'
import { useAuth } from '@/lib/auth/hooks'
import { getDashboardPath } from '@/lib/auth/types'

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

  const [mobileOpen, setMobileOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [cruisesOpen, setCruisesOpen] = useState(false)
  const [mobileCruisesOpen, setMobileCruisesOpen] = useState(false)

  const cruisesRef = useRef<HTMLDivElement>(null)

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

  const privateListings = navListings.filter(l => l.category === 'private')
  const sharedListings = navListings.filter(l => l.category === 'shared')

  return (
    <header className="fixed top-0 left-0 right-0 z-[9999] bg-white/95 backdrop-blur-sm transition-all duration-300">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">

        {/* Logo */}
        <Link href="/" className="flex-shrink-0 flex items-center gap-2.5">
          {/* Arch/gate SVG icon */}
          <svg width="40" height="44" viewBox="0 0 40 44" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="38" height="42" rx="19" stroke="#343499" strokeWidth="1.5" fill="none"/>
            <path d="M8 28 Q10 16 20 14 Q30 16 32 28" stroke="#343499" strokeWidth="1.5" fill="none"/>
            <line x1="14" y1="28" x2="14" y2="36" stroke="#343499" strokeWidth="1.5"/>
            <line x1="26" y1="28" x2="26" y2="36" stroke="#343499" strokeWidth="1.5"/>
            <circle cx="20" cy="22" r="3" stroke="#343499" strokeWidth="1.2" fill="none"/>
            <line x1="8" y1="36" x2="32" y2="36" stroke="#343499" strokeWidth="1.5"/>
          </svg>
          <div className="leading-tight">
            <div className="font-briston text-lg text-[#343499] tracking-wide leading-none">OFFCOURSE</div>
            <div className="font-avenir text-[9px] text-[#343499] tracking-[0.12em] uppercase leading-none mt-0.5">
              your friend with a boat
            </div>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          {/* Cruises dropdown */}
          <div className="relative" ref={cruisesRef}>
            <button
              onClick={() => setCruisesOpen(o => !o)}
              className="flex items-center gap-1 font-avenir font-700 text-sm text-[#343499] hover:text-[#990000] transition-colors"
            >
              {t('cruises')}
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${cruisesOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {cruisesOpen && (
              <div className="absolute left-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-xl border border-[#e5e7eb] py-2 z-50">
                {navListings.length === 0 ? (
                  <Link href="/cruises" className="block px-4 py-2.5 text-sm text-[#343499] hover:bg-[#f5f0e8] transition-colors" onClick={() => setCruisesOpen(false)}>
                    Browse all cruises
                  </Link>
                ) : (
                  <>
                    {privateListings.length > 0 && (
                      <>
                        <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">Private</p>
                        {privateListings.map(listing => (
                          <Link key={listing.id} href={`/cruises/${listing.slug}`}
                            className="block px-4 py-2.5 text-sm text-[#343499] hover:bg-[#f5f0e8] transition-colors"
                            onClick={() => setCruisesOpen(false)}>
                            {listing.title}
                          </Link>
                        ))}
                      </>
                    )}
                    {sharedListings.length > 0 && (
                      <>
                        <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-[#6b7280]">Shared</p>
                        {sharedListings.map(listing => (
                          <Link key={listing.id} href={`/cruises/${listing.slug}`}
                            className="block px-4 py-2.5 text-sm text-[#343499] hover:bg-[#f5f0e8] transition-colors"
                            onClick={() => setCruisesOpen(false)}>
                            {listing.title}
                          </Link>
                        ))}
                      </>
                    )}
                    <div className="border-t border-[#e5e7eb] mt-2 pt-2">
                      <Link href="/cruises"
                        className="flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-[#343499] hover:bg-[#f5f0e8] transition-colors"
                        onClick={() => setCruisesOpen(false)}>
                        Browse all cruises
                        <span className="text-[#990000]">→</span>
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <Link href="/merch" className="font-avenir text-sm text-[#343499] hover:text-[#990000] transition-colors">
            {t('merch')}
          </Link>
          <Link href="/crew" className="font-avenir text-sm text-[#343499] hover:text-[#990000] transition-colors">
            {t('crew')}
          </Link>
        </div>

        {/* Desktop right */}
        <div className="hidden md:flex items-center gap-3">
          {/* Language switcher */}
          <div className="relative">
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 text-sm text-[#6b7280] hover:text-[#343499] transition-colors px-2 py-1 rounded"
              aria-label={t('selectLanguage')}
            >
              <span>{localeFlags[locale as Locale]}</span>
              <span className="uppercase font-avenir text-xs">{locale}</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {langOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-[#e5e7eb] py-1 z-50">
                {locales.map((loc) => (
                  <button key={loc} onClick={() => switchLocale(loc)}
                    className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-[#f5f0e8] transition-colors ${loc === locale ? 'font-bold text-[#343499]' : 'text-[#1f2937]'}`}>
                    <span>{localeFlags[loc]}</span>
                    <span className="font-avenir">{localeNames[loc]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Book Now CTA */}
          <Link href="/cruises"
            className="bg-[#9bb7fd] text-[#990000] border-2 border-[#990000] rounded-full px-5 py-2 font-palmore text-sm hover:bg-[#990000] hover:text-[#9bb7fd] transition-all duration-300">
            {t('bookNow')}
          </Link>

          {/* Auth */}
          {!isLoading && (
            profile ? (
              <div className="relative">
                <button onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 text-sm font-medium text-[#343499] hover:text-[#990000] transition-colors">
                  <span className="w-7 h-7 rounded-full bg-[#343499] text-white flex items-center justify-center text-xs font-bold">
                    {(profile.display_name || profile.email).charAt(0).toUpperCase()}
                  </span>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-[#e5e7eb] py-1 z-50">
                    <Link href={getDashboardPath(profile.role, locale) as string}
                      className="block px-4 py-2 text-sm text-[#343499] hover:bg-[#f5f0e8]"
                      onClick={() => setUserMenuOpen(false)}>
                      My dashboard
                    </Link>
                    <button onClick={() => { setUserMenuOpen(false); signOut() }}
                      className="w-full text-left px-4 py-2 text-sm text-[#343499] hover:bg-[#f5f0e8]">
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link href={`/${locale}/login`}
                className="text-sm font-avenir text-[#6b7280] hover:text-[#343499] transition-colors">
                Log in
              </Link>
            )
          )}
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden p-2 text-[#343499]"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? t('closeMenu') : t('openMenu')}>
          {mobileOpen ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#e5e7eb] bg-white/95 backdrop-blur-sm px-4 pb-4 pt-2">
          <div className="flex flex-col gap-1">
            <div>
              <button onClick={() => setMobileCruisesOpen(o => !o)}
                className="w-full flex items-center justify-between py-2 text-[#343499] font-avenir font-medium hover:text-[#990000]">
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
                      className="block py-2 text-sm font-avenir text-[#6b7280] hover:text-[#343499]"
                      onClick={() => setMobileOpen(false)}>
                      {listing.title}
                    </Link>
                  ))}
                  <Link href="/cruises" className="block py-2 text-sm font-avenir font-bold text-[#343499]"
                    onClick={() => setMobileOpen(false)}>
                    Browse all →
                  </Link>
                </div>
              )}
            </div>
            <Link href="/merch" className="py-2 font-avenir text-[#343499] font-medium hover:text-[#990000]"
              onClick={() => setMobileOpen(false)}>{t('merch')}</Link>
            <Link href="/crew" className="py-2 font-avenir text-[#343499] font-medium hover:text-[#990000]"
              onClick={() => setMobileOpen(false)}>{t('crew')}</Link>
            <Link href="/cruises"
              className="mt-3 bg-[#9bb7fd] text-[#990000] border-2 border-[#990000] rounded-full px-4 py-3 font-palmore text-center hover:bg-[#990000] hover:text-[#9bb7fd] transition-all duration-300"
              onClick={() => setMobileOpen(false)}>{t('bookNow')}</Link>

            {/* Mobile lang switcher */}
            <div className="mt-3 pt-3 border-t border-[#e5e7eb] flex flex-wrap gap-2">
              {locales.map((loc) => (
                <button key={loc} onClick={() => { switchLocale(loc); setMobileOpen(false) }}
                  className={`text-sm px-2 py-1 rounded flex items-center gap-1 font-avenir ${loc === locale ? 'bg-[#343499] text-white font-bold' : 'bg-[#f5f0e8] text-[#343499]'}`}>
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
```

**Step 2: Verify in browser**

Visit http://localhost:3000 — confirm:
- Logo shows arch icon + "OFFCOURSE" in Briston font + "your friend with a boat" tagline
- Book Now button is lavender with crimson border + pill shape
- Nav links are lowercase, dark indigo color

**Step 3: Commit**

```bash
git add src/components/layout/Navbar.tsx
git commit -m "feat: redesign navbar to match live site brand style"
```

---

## Task 5: Redesign HeroSection

**Files:**
- Modify: `src/components/sections/HeroSection.tsx`

**Step 1: Replace HeroSection with brand-styled version**

The existing search logic (fetch + state) is KEPT. Only the visual JSX changes.

Replace full content of `src/components/sections/HeroSection.tsx`:

```tsx
'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchResults } from '@/components/search/SearchResults'
import type { SearchResult } from '@/types'

export function HeroSection() {
  const t = useTranslations('home.hero')
  const [searchState, setSearchState] = useState<{
    date: string
    guests: number
    results: SearchResult[]
    loading: boolean
    searched: boolean
  }>({
    date: '',
    guests: 2,
    results: [],
    loading: false,
    searched: false,
  })

  const resultsRef = useRef<HTMLDivElement>(null)

  async function handleSearch(date: string, guests: number) {
    setSearchState(s => ({ ...s, loading: true, searched: true, date, guests }))
    try {
      const params = new URLSearchParams({ date, guests: String(guests) })
      const res = await fetch(`/api/search?${params}`)
      const data = await res.json()
      setSearchState(s => ({ ...s, loading: false, results: data.results ?? [] }))
    } catch {
      setSearchState(s => ({ ...s, loading: false, results: [] }))
    }
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  return (
    <>
      {/* Hero Section */}
      <section className="bg-texture-sand relative min-h-screen flex items-center justify-center overflow-hidden pt-16">

        {/* Scattered polaroid — top left */}
        <div className="absolute top-16 left-4 xl:left-8 hidden md:block z-0"
          style={{ transform: 'rotate(-12deg)' }}>
          <div className="bg-white p-2 pb-6 shadow-polaroid w-44">
            <div className="aspect-[4/3] bg-[#e5e7eb] overflow-hidden">
              <img
                src="https://offcourseamsterdam.com/lovable-uploads/7bfebada-39ca-4fe1-9e54-d91a54bc47f9.png"
                alt="Amsterdam canal"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>

        {/* Scattered polaroid — top right */}
        <div className="absolute top-24 right-4 xl:right-8 hidden md:block z-0"
          style={{ transform: 'rotate(8deg)' }}>
          <div className="bg-white p-2 pb-6 shadow-polaroid w-44">
            <div className="aspect-[4/3] bg-[#e5e7eb] overflow-hidden">
              <img
                src="https://offcourseamsterdam.com/lovable-uploads/1d2e5c89-6175-4ec5-a8ba-11a7773a5b19.png"
                alt="Off Course boat"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>

        {/* Scattered polaroid — bottom left */}
        <div className="absolute bottom-20 left-2 xl:left-6 hidden md:block z-0"
          style={{ transform: 'rotate(15deg)' }}>
          <div className="bg-white p-2 pb-6 shadow-polaroid w-44">
            <div className="aspect-[4/3] bg-[#e5e7eb] overflow-hidden">
              <img
                src="https://offcourseamsterdam.com/lovable-uploads/3b2a1234-abcd-4567-89ef-123456789abc.png"
                alt="Guests on boat"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>

        {/* Center content */}
        <div className="relative z-10 text-center px-4 sm:px-6 max-w-2xl mx-auto">
          <h1 className="font-briston text-[80px] sm:text-[96px] lg:text-[108px] leading-none text-[#343499] mb-4"
            style={{ letterSpacing: '0.02em' }}>
            {t('title')}
          </h1>

          <p className="font-palmore text-[48px] sm:text-[60px] text-[#343499] leading-tight mb-8">
            {t('tagline')}
          </p>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="flex gap-0.5">
              {[1,2,3,4,5].map(i => (
                <svg key={i} className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              ))}
            </div>
            <span className="font-avenir text-sm text-[#6b7280]">110+ reviews across platforms</span>
          </div>

          {/* Search bar */}
          <SearchBar onSearch={handleSearch} loading={searchState.loading} />
        </div>
      </section>

      {/* Search results below hero */}
      {searchState.searched && (
        <div ref={resultsRef}>
          <SearchResults
            results={searchState.results}
            date={searchState.date}
            guests={searchState.guests}
            loading={searchState.loading}
          />
        </div>
      )}
    </>
  )
}
```

> **Note on polaroid images:** The `src` URLs above are placeholders using the live site CDN. During implementation, check the actual image URLs available on the live site by inspecting the DOM. If they 404, use a gray placeholder div instead: `<div className="w-full h-full bg-[#d1d5db]" />`.

**Step 2: Verify in browser**

Visit http://localhost:3000 — confirm:
- Full-screen sand-textured hero
- "YOUR FRIEND WITH A BOAT" in large Briston font, indigo color
- "welcome home" in Palmore font below
- Stars + "110+ reviews" text
- Search bar visible below

**Step 3: Commit**

```bash
git add src/components/sections/HeroSection.tsx
git commit -m "feat: redesign hero section with brand fonts + polaroid photos"
```

---

## Task 6: Redesign SearchBar

**Files:**
- Modify: `src/components/search/SearchBar.tsx`

**Step 1: Update SearchBar visual style**

Replace the form wrapper and button styles. All logic stays identical.

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface SearchBarProps {
  onSearch: (date: string, guests: number) => void
  initialDate?: string
  initialGuests?: number
  loading?: boolean
}

export function SearchBar({ onSearch, initialDate = '', initialGuests = 2, loading = false }: SearchBarProps) {
  const t = useTranslations('search')
  const today = new Date().toISOString().split('T')[0]

  const [date, setDate] = useState(initialDate)
  const [guests, setGuests] = useState(initialGuests)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date) return
    onSearch(date, guests)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row gap-0 bg-white/90 backdrop-blur-sm rounded-full px-2 py-2 shadow-xl w-full max-w-xl items-center"
    >
      {/* Date */}
      <div className="flex-1 px-4">
        <label htmlFor="search-date"
          className="block text-[10px] font-avenir font-bold uppercase tracking-wider text-[#6b7280] mb-0.5">
          {t('date')}
        </label>
        <input
          id="search-date"
          type="date"
          value={date}
          min={today}
          onChange={e => setDate(e.target.value)}
          required
          className="w-full bg-transparent font-avenir text-[#343499] text-sm font-bold outline-none cursor-pointer"
        />
      </div>

      <div className="hidden sm:block w-px h-8 bg-[#e5e7eb]" />

      {/* Guests */}
      <div className="sm:w-32 px-4">
        <label htmlFor="search-guests"
          className="block text-[10px] font-avenir font-bold uppercase tracking-wider text-[#6b7280] mb-0.5">
          {t('guests')}
        </label>
        <select
          id="search-guests"
          value={guests}
          onChange={e => setGuests(Number(e.target.value))}
          className="w-full bg-transparent font-avenir text-[#343499] text-sm font-bold outline-none cursor-pointer"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
            <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>
          ))}
        </select>
      </div>

      {/* Search button */}
      <button
        type="submit"
        disabled={!date || loading}
        className="bg-[#9bb7fd] text-[#990000] border-2 border-[#990000] rounded-full px-6 py-2.5 font-palmore text-sm whitespace-nowrap hover:bg-[#990000] hover:text-[#9bb7fd] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? '...' : t('search')}
      </button>
    </form>
  )
}
```

**Step 2: Verify**

In browser, the search bar should look like a pill-shaped white/translucent bar with the branded Search button.

**Step 3: Commit**

```bash
git add src/components/search/SearchBar.tsx
git commit -m "feat: redesign search bar to brand pill style"
```

---

## Task 7: Redesign FeaturedCruises ("Off The Beaten Canal" Section)

**Files:**
- Modify: `src/components/sections/FeaturedCruises.tsx`

**Step 1: Replace FeaturedCruises with new design**

This section gets the lavender background and 2 side-by-side cruise cards in polaroid style.

```tsx
import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'

type CruiseListing = Database['public']['Tables']['cruise_listings']['Row']

interface FeaturedCruisesProps {
  listings: CruiseListing[]
  locale: Locale
}

export async function FeaturedCruises({ listings, locale }: FeaturedCruisesProps) {
  const t = await getTranslations('home.featured')

  // Separate private and shared listings
  const privateListings = listings.filter(l => l.category === 'private')
  const sharedListings = listings.filter(l => l.category === 'shared')
  const displayListings = [
    ...(privateListings.length > 0 ? [privateListings[0]] : []),
    ...(sharedListings.length > 0 ? [sharedListings[0]] : []),
    ...listings.slice(0, 2),
  ].slice(0, 2)

  return (
    <section className="bg-texture-lavender min-h-screen flex items-center justify-center py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-12">
          <h2 className="font-briston text-[56px] sm:text-[72px] text-[#990000] leading-none mb-3">
            OFF THE BEATEN CANAL
          </h2>
          <p className="font-palmore text-[32px] sm:text-[40px] text-[#343499] leading-tight">
            we drift different
          </p>
        </div>

        {/* Cruise cards */}
        {displayListings.length === 0 ? (
          <div className="text-center">
            <Link href="/cruises" className="btn-cta">Browse all cruises</Link>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-8 justify-center items-start">
            {displayListings.map((listing) => {
              const title = getLocalizedField(listing, 'title', locale)
              const description = getLocalizedField(listing, 'description', locale)
              const isPrivate = listing.category === 'private'

              return (
                <div key={listing.id} className="bg-white p-6 pb-8 shadow-2xl w-full sm:w-80 flex-shrink-0">
                  {/* Badge */}
                  <div className="mb-3">
                    <span className={`inline-block text-xs font-avenir font-bold uppercase tracking-wider px-3 py-1 rounded-full ${isPrivate ? 'bg-[#343499] text-white' : 'bg-[#9bb7fd] text-[#343499]'}`}>
                      {isPrivate ? 'Private Tour' : 'Shared Experience'}
                    </span>
                  </div>

                  {/* Photo */}
                  <div className="relative aspect-[4/3] overflow-hidden bg-[#e5e7eb] mb-4">
                    {listing.hero_image_url ? (
                      <Image
                        src={listing.hero_image_url}
                        alt={title}
                        fill
                        sizes="320px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#343499]/20 to-[#343499]/5" />
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="font-avenir font-bold text-[#1f2937] text-lg mb-2 leading-tight">{title}</h3>

                  {/* Description */}
                  {description && (
                    <p className="font-avenir text-[#6b7280] text-sm leading-relaxed mb-4 line-clamp-3">
                      {description}
                    </p>
                  )}

                  {/* Price */}
                  {listing.price_display && (
                    <p className="font-avenir font-bold text-[#343499] text-base mb-1">{listing.price_display}</p>
                  )}
                  {listing.minimum_duration_hours && (
                    <p className="font-avenir text-[#6b7280] text-xs mb-5">
                      {listing.minimum_duration_hours * 60} minutes minimum
                    </p>
                  )}

                  {/* CTAs */}
                  <div className="flex gap-3">
                    <Link
                      href={`/cruises/${listing.slug}`}
                      className="flex-1 bg-[#9bb7fd] text-[#990000] border-2 border-[#990000] rounded-full py-2.5 font-palmore text-sm text-center hover:bg-[#990000] hover:text-[#9bb7fd] transition-all duration-300"
                    >
                      Book
                    </Link>
                    <Link
                      href={`/cruises/${listing.slug}`}
                      className="flex-1 bg-transparent text-white border-2 border-white rounded-full py-2.5 font-avenir text-sm text-center hover:bg-white hover:text-[#343499] transition-all duration-300"
                    >
                      More Info
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
```

**Step 2: Verify in browser**

Section 2 on the homepage should show lavender textured background with "OFF THE BEATEN CANAL" in large crimson Briston font, and 2 white cruise cards side by side.

**Step 3: Commit**

```bash
git add src/components/sections/FeaturedCruises.tsx
git commit -m "feat: redesign featured cruises as 'Off The Beaten Canal' section"
```

---

## Task 8: Create PrioritiesSection ("We Got Our Priorities Straight")

**Files:**
- Create: `src/components/sections/PrioritiesSection.tsx`

**Step 1: Create the new component**

```tsx
// src/components/sections/PrioritiesSection.tsx
// "We Got Our Priorities Straight" — 4 polaroid value cards on sand texture

const VALUES = [
  {
    id: 'shoes',
    headline: 'kick off your shoes',
    body: 'No performance, just you being you. Come as you are and stay that way.',
    img: 'https://offcourseamsterdam.com/lovable-uploads/7d5ae741-eb50-44a3-832f-59f671eb36b4.png',
    rotate: '-rotate-2',
  },
  {
    id: 'fridge',
    headline: 'you know where the fridge is',
    body: 'Cold beer, local wine, fresh juice, and sparkling water. Help yourself — this is your floating living room.',
    img: 'https://offcourseamsterdam.com/lovable-uploads/ad6c9d0c-cc35-4a89-91a7-7caed8b9b4d0.png',
    rotate: 'rotate-1',
  },
  {
    id: 'canal',
    headline: 'off the beaten canal',
    body: "We take the scenic route through quieter waters, away from the tourist crowds and into Amsterdam's hidden corners.",
    img: 'https://offcourseamsterdam.com/lovable-uploads/9c2aa29d-afe4-43aa-af33-a25c8f6de3c7.png',
    rotate: '-rotate-1',
  },
  {
    id: 'drift',
    headline: 'we drift different',
    body: 'Local stories, hidden quirks, and personal tales about life on the water.',
    img: 'https://offcourseamsterdam.com/lovable-uploads/8e78c8b4-c1ce-4700-9eb4-42a88843b11f.png',
    rotate: 'rotate-2',
  },
]

export function PrioritiesSection() {
  return (
    <section className="bg-texture-sand min-h-screen flex items-center justify-center py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="font-briston text-[40px] sm:text-[56px] lg:text-[72px] text-[#990000] leading-none mb-3">
            WE GOT OUR PRIORITIES STRAIGHT
          </h2>
          <p className="font-palmore text-[28px] sm:text-[36px] text-[#343499] leading-tight">
            make yourself at home
          </p>
        </div>

        {/* 2×2 polaroid grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-10">
          {VALUES.map((value) => (
            <div key={value.id} className={`bg-white rounded-[2px] shadow-polaroid overflow-hidden mx-auto w-64 ${value.rotate}`}>
              {/* Photo */}
              <div className="aspect-[4/3] overflow-hidden bg-[#e5e7eb]">
                <img
                  src={value.img}
                  alt={value.headline}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              </div>
              {/* Caption */}
              <div className="p-4 pb-6">
                <p className="font-palmore text-[18px] text-[#343499] leading-tight mb-1">{value.headline}</p>
                <p className="font-avenir text-xs text-[#6b7280] leading-relaxed">{value.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

**Step 2: Verify**

Add `<PrioritiesSection />` temporarily to page.tsx and check in browser.

**Step 3: Commit**

```bash
git add src/components/sections/PrioritiesSection.tsx
git commit -m "feat: add PrioritiesSection ('We Got Our Priorities Straight')"
```

---

## Task 9: Create FleetSection ("Meet The Fleet")

**Files:**
- Create: `src/components/sections/FleetSection.tsx`

**Step 1: Create the component**

```tsx
// src/components/sections/FleetSection.tsx
// "Meet The Fleet" — boat photos on purple texture background

const FLEET_PHOTOS = [
  {
    id: 'fleet-1',
    src: 'https://offcourseamsterdam.com/lovable-uploads/c742e6cd-f7c5-4819-99f0-56a5d8cf1b29.png',
    alt: 'Diana on the Amsterdam canals',
    rotate: '-rotate-2',
  },
  {
    id: 'fleet-2',
    src: 'https://offcourseamsterdam.com/lovable-uploads/b3a23b33-bcc3-4e42-bcb1-39a2e2d3b9de.png',
    alt: 'Guests enjoying the cruise',
    rotate: 'rotate-1',
  },
  {
    id: 'fleet-3',
    src: 'https://offcourseamsterdam.com/lovable-uploads/5f9b7c26-cf5b-4e1f-9ccd-a4e4e9f7a0e6.png',
    alt: 'Amsterdam skyline from the water',
    rotate: '-rotate-1',
  },
  {
    id: 'fleet-4',
    src: 'https://offcourseamsterdam.com/lovable-uploads/d0c35e16-e59c-4e89-9e1b-4823c8b25aa6.png',
    alt: 'Diana at dock',
    rotate: 'rotate-2',
  },
]

export function FleetSection() {
  return (
    <section className="bg-texture-purple min-h-screen flex items-center justify-center py-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="font-briston text-[48px] sm:text-[72px] text-[#343499] leading-none mb-3">
            MEET THE FLEET
          </h2>
          <p className="font-palmore text-[28px] sm:text-[40px] text-[#343499] leading-tight mb-6">
            feet up, mind off
          </p>
          <p className="font-avenir text-base text-[#343499]/80 max-w-xl mx-auto leading-relaxed">
            For now, our fleet consists of one. She&apos;s a beautiful, classic saloon boat from 1920,
            fully restored with love and powered by a silent electric engine. She&apos;s got all the
            character of old Amsterdam with the comfort of today.
          </p>
        </div>

        {/* 2×2 photo grid */}
        <div className="grid grid-cols-2 gap-4 sm:gap-8 mt-10">
          {FLEET_PHOTOS.map((photo) => (
            <div key={photo.id} className={`bg-white rounded-[2px] shadow-polaroid overflow-hidden ${photo.rotate}`}>
              <div className="aspect-[4/3] overflow-hidden bg-[#e5e7eb]">
                <img
                  src={photo.src}
                  alt={photo.alt}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              </div>
              <div className="h-6" /> {/* Polaroid bottom margin */}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/sections/FleetSection.tsx
git commit -m "feat: add FleetSection ('Meet The Fleet')"
```

---

## Task 10: Create LocationSection ("Where We'll Meet")

**Files:**
- Create: `src/components/sections/LocationSection.tsx`

**Step 1: Create the component**

```tsx
// src/components/sections/LocationSection.tsx
// "Where We'll Meet" — map + address + final CTA

import { Link } from '@/i18n/navigation'

export function LocationSection() {
  return (
    <section className="bg-texture-sand min-h-screen flex items-center justify-center py-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="font-briston text-[48px] sm:text-[72px] text-[#990000] leading-none mb-3">
            WHERE WE&apos;LL MEET
          </h2>
          <p className="font-palmore text-[28px] sm:text-[40px] text-[#343499] leading-tight">
            smooth sailing ahead (probably)
          </p>
        </div>

        {/* Content: text left + map right */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
          {/* Left: address + copy */}
          <div>
            <h3 className="font-briston text-2xl text-[#343499] mb-4">READY TO FLOAT?</h3>
            <p className="font-avenir text-[#1f2937] leading-relaxed mb-4">
              We&apos;ll meet you at one of the most beautiful canals in the heart of Amsterdam.
              5 minutes walking from central station. Find us at the large dock on the canal side.
            </p>
            <p className="font-avenir text-[#1f2937] leading-relaxed mb-6">
              Easy to find, easy to get to, and the perfect start to your floating adventure.
            </p>
            <div className="font-avenir text-[#343499] font-bold text-sm">
              <p>Herenmarkt 93A</p>
              <p>1013EC Amsterdam</p>
              <p>The Netherlands</p>
            </div>
          </div>

          {/* Right: Google Maps embed */}
          <div className="rounded-lg overflow-hidden shadow-lg">
            <iframe
              title="Off Course Amsterdam departure point"
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2435.8!2d4.8897!3d52.3791!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47c609b6462f3d6b%3A0x3c2e1b5c2e4b8a1!2sHerenmarkt%2093A%2C%201013%20EC%20Amsterdam!5e0!3m2!1sen!2snl!4v1712000000000"
              width="100%"
              height="350"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-16">
          <p className="font-briston text-2xl text-[#343499] mb-6">READY TO DRIFT?</p>
          <Link
            href="/cruises"
            className="bg-[#9bb7fd] text-[#990000] border-2 border-[#990000] rounded-full px-10 py-4 font-palmore text-xl hover:bg-[#990000] hover:text-[#9bb7fd] transition-all duration-300 inline-block"
          >
            Book Your Journey
          </Link>
        </div>
      </div>
    </section>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/sections/LocationSection.tsx
git commit -m "feat: add LocationSection ('Where We'll Meet') with map + CTA"
```

---

## Task 11: Redesign Footer

**Files:**
- Modify: `src/components/layout/Footer.tsx`

**Step 1: Replace Footer with brand design**

```tsx
'use client'

import { Link } from '@/i18n/navigation'

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-texture-yellow py-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Center logo */}
        <div className="flex flex-col items-center mb-10">
          {/* Arch SVG (same as navbar, larger) */}
          <svg width="60" height="66" viewBox="0 0 40 44" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-3">
            <rect x="1" y="1" width="38" height="42" rx="19" stroke="#343499" strokeWidth="1.5" fill="none"/>
            <path d="M8 28 Q10 16 20 14 Q30 16 32 28" stroke="#343499" strokeWidth="1.5" fill="none"/>
            <line x1="14" y1="28" x2="14" y2="36" stroke="#343499" strokeWidth="1.5"/>
            <line x1="26" y1="28" x2="26" y2="36" stroke="#343499" strokeWidth="1.5"/>
            <circle cx="20" cy="22" r="3" stroke="#343499" strokeWidth="1.2" fill="none"/>
            <line x1="8" y1="36" x2="32" y2="36" stroke="#343499" strokeWidth="1.5"/>
          </svg>
          <div className="font-briston text-3xl text-[#343499] tracking-wide leading-none">OFFCOURSE</div>
          <div className="font-avenir text-xs text-[#343499] tracking-[0.15em] uppercase mt-1">your friend with a boat</div>
        </div>

        {/* Tagline */}
        <p className="font-avenir text-center text-[#343499] text-sm leading-relaxed max-w-md mx-auto mb-12">
          we create boats with vibes so good, the effect is instant.
          you&apos;re relaxed, connected, and fully present.
        </p>

        {/* Two columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-sm mx-auto mb-12">
          {/* Navigate */}
          <div>
            <h3 className="font-briston text-lg text-[#343499] mb-4 tracking-wide">NAVIGATE</h3>
            <ul className="space-y-2 font-avenir text-sm text-[#343499]">
              <li><Link href="/" className="hover:text-[#990000] transition-colors">Home</Link></li>
              <li><Link href="/cruises" className="hover:text-[#990000] transition-colors">Our Cruises</Link></li>
              <li><Link href="/crew" className="hover:text-[#990000] transition-colors">About the Crew</Link></li>
              <li><Link href="/merch" className="hover:text-[#990000] transition-colors">Merch</Link></li>
            </ul>
          </div>

          {/* Get In Touch */}
          <div>
            <h3 className="font-briston text-lg text-[#343499] mb-4 tracking-wide">GET IN TOUCH</h3>
            <ul className="space-y-2 font-avenir text-sm text-[#343499]">
              <li>
                <a href="mailto:cruise@offcourseamsterdam.com" className="hover:text-[#990000] transition-colors">
                  cruise@offcourseamsterdam.com
                </a>
              </li>
              <li>
                <a href="tel:+31645351618" className="hover:text-[#990000] transition-colors">
                  +316 45 35 16 18
                </a>
              </li>
              <li className="text-[#343499]/70">Herenmarkt 93A</li>
              <li className="text-[#343499]/70">1013EC Amsterdam</li>
              <li className="text-[#343499]/70">The Netherlands</li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-[#343499]/20 pt-6 text-center">
          <div className="flex items-center justify-center gap-4 flex-wrap mb-3">
            <Link href="/privacy" className="font-avenir text-xs text-[#343499]/60 hover:text-[#343499] transition-colors">
              Privacy Policy
            </Link>
            <span className="text-[#343499]/30">·</span>
            <Link href="/terms" className="font-avenir text-xs text-[#343499]/60 hover:text-[#343499] transition-colors">
              Terms
            </Link>
          </div>
          <p className="font-avenir text-xs text-[#343499]/50">
            © {year} Off Course Amsterdam. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/layout/Footer.tsx
git commit -m "feat: redesign footer with yellow texture + brand layout"
```

---

## Task 12: Wire Up Homepage

**Files:**
- Modify: `src/app/[locale]/page.tsx`

**Step 1: Update page.tsx to use all sections**

```tsx
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { HeroSection } from '@/components/sections/HeroSection'
import { FeaturedCruises } from '@/components/sections/FeaturedCruises'
import { PrioritiesSection } from '@/components/sections/PrioritiesSection'
import { FleetSection } from '@/components/sections/FleetSection'
import { LocationSection } from '@/components/sections/LocationSection'
import type { Locale } from '@/lib/i18n/config'

export const revalidate = 60

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'home.hero' })
  return {
    title: 'Off Course Amsterdam — Your friend with a boat',
    description: t('subtitle'),
  }
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params
  const supabase = await createClient()

  const { data: listings } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('is_published', true)
    .eq('is_featured', true)
    .order('display_order', { ascending: true })
    .limit(4)

  return (
    <>
      <HeroSection />
      <FeaturedCruises listings={listings ?? []} locale={locale as Locale} />
      <PrioritiesSection />
      <FleetSection />
      <LocationSection />
    </>
  )
}
```

**Step 2: Full visual verification**

```bash
npm run dev
```

Visit http://localhost:3000 and verify ALL sections:
1. ✅ Navbar: OFFCOURSE logo + lavender Book Now button
2. ✅ Hero: Sand texture, big Briston heading, Palmore subtitle, stars, search bar
3. ✅ Cruises: Lavender texture, crimson "OFF THE BEATEN CANAL" heading, 2 white cards
4. ✅ Priorities: Sand texture, "WE GOT OUR PRIORITIES STRAIGHT", 4 polaroid cards
5. ✅ Fleet: Purple texture, "MEET THE FLEET", 4 boat photo polaroids
6. ✅ Location: Sand texture, "WHERE WE'LL MEET", map, final CTA
7. ✅ Footer: Yellow texture, OFFCOURSE logo, 2 columns, copyright

Compare side-by-side with https://offcourseamsterdam.com

**Step 3: Fix TypeScript errors if any**

```bash
npm run build 2>&1 | head -50
```

Fix any type errors before final commit.

**Step 4: Final commit**

```bash
git add src/app/\[locale\]/page.tsx
git commit -m "feat: wire up homepage with all 5 sections (hero, cruises, priorities, fleet, location)"
```

---

## Task 13: Polish — SearchResults & SearchResultCard Brand Styling

**Files:**
- Modify: `src/components/search/SearchResults.tsx`
- Modify: `src/components/search/SearchResultCard.tsx`

**Step 1: Update SearchResults wrapper**

In `SearchResults.tsx`, change the section background and heading styles:
- `section className`: change from `bg-[var(--color-sand)]` → `bg-texture-sand`
- `h2 className`: change to `font-briston text-3xl text-[#990000]`

**Step 2: Update SearchResultCard**

In `SearchResultCard.tsx`:
- `article className`: change from `bg-white rounded-2xl` → `bg-white rounded-[2px] shadow-polaroid`
- `h3 className`: change `text-[var(--color-primary)]` → `text-[#343499]`
- `"Book →" span`: change to `font-avenir font-bold text-[#990000]`
- Price display: change `text-[var(--color-primary)]` → `text-[#343499]`

**Step 3: Commit**

```bash
git add src/components/search/SearchResults.tsx src/components/search/SearchResultCard.tsx
git commit -m "feat: apply brand styling to search results"
```

---

## Task 14: Final Verification + TypeScript Build

**Step 1: Check no TS errors**

```bash
npm run build
```
Expected: Build completes successfully (no red errors). Warnings are OK.

**Step 2: Check all pages render**

Visit these pages and confirm no crashes:
- http://localhost:3000 (homepage)
- http://localhost:3000/cruises
- http://localhost:3000/en (locale routing)
- http://localhost:3000/nl (Dutch locale)

**Step 3: Check mobile layout**

In Chrome DevTools, switch to iPhone 375px viewport. Verify:
- Polaroid photos in hero are hidden (they have `hidden md:block`)
- All sections stack vertically cleanly
- Search bar is usable on mobile

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete homepage frontend rebuild matching live site design"
```

---

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| Font not loading | Check `public/fonts/` files are non-empty. Check `@font-face` `src` path starts with `/fonts/` |
| Texture not showing | Check `public/textures/` files downloaded correctly. Check `.bg-texture-sand` utility has correct path `/textures/bg-sand.png` |
| Polaroid images 404 | Replace `<img src="CDN_URL">` with `<div className="bg-[#d1d5db] w-full h-full" />` placeholder |
| `font-briston` not applying | In Tailwind v4, custom utilities in `@layer utilities` should work. If not, use inline style `style={{ fontFamily: 'Briston_Regular, serif' }}` |
| Build error on `Link` import | Import from `@/i18n/navigation` not `next/link` |
| Google Maps iframe CSP error | Add `frame-src https://www.google.com` to `next.config.ts` headers |
