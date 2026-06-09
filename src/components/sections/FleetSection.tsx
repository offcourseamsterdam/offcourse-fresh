'use client'

import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { Users, Zap } from 'lucide-react'
import { SafeImage } from '@/components/ui/SafeImage'
import { sectionRootStyle, roleColor, type SectionStyle } from '@/lib/homepage/section-styles'

type BoatState = 'open' | 'covered' | 'interior'

export type BoatData = {
  id: string
  name: string
  built_year: number | null
  max_capacity: number | null
  description: string | null
  photo_url: string | null
  photo_covered_url: string | null
  photo_interior_url: string | null
}

const STATES: { key: BoatState; label: string }[] = [
  { key: 'open',     label: 'Open' },
  { key: 'covered',  label: 'Covered' },
  { key: 'interior', label: 'Interior' },
]

// ── The physical-stack model ─────────────────────────────────────────────────
// Each state is a COUNT of how many polaroid cards are in the stack:
//   Interior = 1 card (the base, always present)
//   Covered  = 2 cards (Covered sits on Interior)
//   Open     = 3 cards (Open sits on top of all)
// The card you see is always the TOP one. Each card has a fixed identity (level),
// so when it leaves and you click back, the *same* card returns to the deck.
const COUNT_FOR: Record<BoatState, number> = { interior: 1, covered: 2, open: 3 }
const LEVELS: { level: number; state: BoatState }[] = [
  { level: 1, state: 'interior' }, // base / bottom
  { level: 2, state: 'covered' },  // middle
  { level: 3, state: 'open' },     // top / outermost
]
const STAGGER = 130          // ms between dealt cards
const PHOTO_RATIO = '4 / 3'  // uniform polaroid window — photos crop to fill
const CARD_W = 'clamp(288px, 38vw, 480px)'

// Fallback boats when DB isn't seeded yet
const FALLBACK_BOATS: BoatData[] = [
  {
    id: 'diana',
    name: 'Diana',
    built_year: 1915,
    max_capacity: 8,
    description: 'A beautiful, classic saloon boat from 1920, fully restored with love and powered by a silent electric engine. No fumes, no noise — just the soft sound of water.',
    photo_url: null,
    photo_covered_url: null,
    photo_interior_url: null,
  },
  {
    id: 'curacao',
    name: 'Curaçao',
    built_year: 1951,
    max_capacity: 12,
    description: null,
    photo_url: null,
    photo_covered_url: null,
    photo_interior_url: null,
  },
]

// ── One physical polaroid (uniform size — photo crops to fill) ────────────────
function PolaroidShell({ name, img, stateLabel }: { name: string; img: string | null; stateLabel?: string }) {
  return (
    <div className="bg-white shadow-polaroid p-2 sm:p-2.5 flex flex-col w-full">
      <div className="relative w-full overflow-hidden bg-[#e5e7eb]" style={{ aspectRatio: PHOTO_RATIO }}>
        {img ? (
          <SafeImage
            src={img}
            alt={`${name} ${stateLabel ?? ''}`.trim()}
            fill
            sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 500px"
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-avenir text-xs text-[#9ca3af]">No image yet</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center pt-1.5 pb-0.5" style={{ minHeight: '40px' }}>
        <p className="font-palmore text-primary text-center lowercase" style={{ fontSize: 'clamp(30px, 4.5vw, 42px)' }}>
          {name.toLowerCase()}
        </p>
      </div>
    </div>
  )
}

function BoatCard({ boat, slideDir = 1 }: { boat: BoatData; slideDir?: 1 | -1 }) {
  const [activeState, setActiveState] = useState<BoatState>('open')
  const count = COUNT_FOR[activeState]

  // Track the previous count so we know the direction of change (adding vs
  // removing cards) — that decides the stagger order of the dealt cards. During
  // the render where count just changed, the ref still holds the OLD count.
  const prevCountRef = useRef(count)
  const prevCount = prevCountRef.current
  useEffect(() => { prevCountRef.current = count }, [count])
  const increasing = count > prevCount

  const photoForState = (s: BoatState): string | null =>
    s === 'open' ? boat.photo_url : s === 'covered' ? boat.photo_covered_url : boat.photo_interior_url

  // Position + timing for a card, given the current count.
  function cardStyle(level: number): CSSProperties {
    const present = level <= count
    let transform: string
    let opacity: number
    let zIndex: number

    if (!present) {
      // Removed → slides off to the side (and back). Direction depends on the
      // column: left column slides off to the right, right column to the left.
      const offX = slideDir === 1 ? 'calc(-50% + 115%)' : 'calc(-50% - 115%)'
      const tilt = slideDir === 1 ? '7deg' : '-7deg'
      transform = `translateX(${offX}) translateY(4px) rotate(${tilt}) scale(0.97)`
      opacity = 0
      zIndex = 200 + level // stays above the deck while it slides off / back
    } else {
      const depth = count - level // 0 = active (top), 1 + 2 = behind, fanned out
      if (depth === 0)      transform = 'translateX(-50%) translateY(0) rotate(0deg) scale(1)'
      else if (depth === 1) transform = 'translateX(calc(-50% + 13px)) translateY(13px) rotate(3deg) scale(0.965)'
      else                  transform = 'translateX(calc(-50% - 15px)) translateY(25px) rotate(-3.5deg) scale(0.93)'
      opacity = 1
      zIndex = 100 - depth // active sits on top of the cards behind it
    }

    // Stagger: dealing cards in goes bottom-up (lowest level first); lifting
    // cards off goes top-down (highest level first).
    let delay = 0
    if (increasing && level > prevCount && level <= count) {
      delay = (level - prevCount - 1) * STAGGER
    } else if (!increasing && level > count && level <= prevCount) {
      delay = (prevCount - level) * STAGGER
    }

    return {
      transform,
      opacity,
      zIndex,
      transitionProperty: 'transform, opacity',
      transitionDuration: '0.5s, 0.45s',
      transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1), ease',
      transitionDelay: `${delay}ms`,
    }
  }

  return (
    <div className="flex flex-col items-center">

      {/* The stack — uniform-size cards, absolutely positioned + centred. A
          hidden sizer card (in normal flow) gives the box its height; the extra
          bottom padding leaves room for the fanned cards behind. */}
      <div className="relative" style={{ width: CARD_W, paddingBottom: '2rem' }}>
        <div className="invisible" aria-hidden>
          <PolaroidShell name={boat.name} img={null} />
        </div>

        {LEVELS.map(({ level, state }) => (
          <div
            key={level}
            className="absolute top-0 left-1/2 w-full will-change-transform"
            style={cardStyle(level)}
          >
            <PolaroidShell name={boat.name} img={photoForState(state)} stateLabel={state} />
          </div>
        ))}
      </div>

      {/* State selector pills */}
      <div className="flex gap-2 mt-6 bg-white/60 backdrop-blur-sm rounded-full p-1.5">
        {STATES.map(s => (
          <button
            key={s.key}
            onClick={() => setActiveState(s.key)}
            className={`px-5 py-2 rounded-full font-avenir text-sm font-medium transition-all duration-300 ${
              activeState === s.key
                ? 'bg-primary text-white shadow-sm'
                : 'text-primary hover:bg-white/80'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Specs */}
      <div className="flex items-center gap-3 mt-4 font-avenir text-sm" style={{ color: roleColor('body', '#343499') }}>
        {boat.built_year && <span>Built {boat.built_year}</span>}
        {boat.built_year && boat.max_capacity && <span className="text-primary/30">·</span>}
        {boat.max_capacity && (
          <span className="flex items-center gap-1">
            <Users size={13} /> Max: {boat.max_capacity} people
          </span>
        )}
        <span className="text-primary/30">·</span>
        <span className="electric-hover flex items-center gap-1">
          <Zap size={13} /> Electric
        </span>
      </div>

      {/* Description */}
      {boat.description && (
        <p className="font-palmore text-center leading-relaxed mt-3 max-w-sm lowercase" style={{ fontSize: 'clamp(20px, 2.5vw, 28px)', color: roleColor('body', '#343499'), opacity: 0.85 }}>
          &ldquo;{boat.description}&rdquo;
        </p>
      )}
    </div>
  )
}

interface FleetSectionProps {
  boats?: BoatData[]
  sectionStyle?: SectionStyle
}

export function FleetSection({ boats = FALLBACK_BOATS, sectionStyle }: FleetSectionProps) {
  return (
    <section className="bg-texture-purple min-h-screen flex items-center justify-center py-20" style={sectionRootStyle(sectionStyle)}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] leading-none mb-3" style={{ color: roleColor('h2', '#343499') }}>
            MEET THE FLEET
          </h2>
          <p className="font-palmore text-[32px] sm:text-[40px] leading-tight" style={{ color: roleColor('h3', '#343499') }}>
            feet up, mind off
          </p>
        </div>

        {/* Two boat cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-8 justify-items-center">
          {boats.map((boat, i) => (
            // Left column (even) slides right→left; right column (odd) left→right.
            <BoatCard key={boat.id} boat={boat} slideDir={i % 2 === 0 ? -1 : 1} />
          ))}
        </div>

      </div>
    </section>
  )
}
