'use client'

import { useState } from 'react'
import { Users, Zap } from 'lucide-react'
import { hideOnError } from '@/lib/utils/image'

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

function BoatCard({ boat }: { boat: BoatData }) {
  const [activeState, setActiveState] = useState<BoatState>('open')
  const [prevState, setPrevState] = useState<BoatState | null>(null)
  const [animating, setAnimating] = useState(false)

  const photoForState = (state: BoatState): string | null => {
    if (state === 'open') return boat.photo_url
    if (state === 'covered') return boat.photo_covered_url
    return boat.photo_interior_url
  }

  const currentImage = photoForState(activeState)

  function switchState(next: BoatState) {
    if (next === activeState || animating) return
    setPrevState(activeState)
    setAnimating(true)
    setActiveState(next)
    setTimeout(() => {
      setPrevState(null)
      setAnimating(false)
    }, 400)
  }

  return (
    <div className="flex flex-col items-center">

      {/* Stacked polaroid */}
      <div className="relative" style={{ width: 'clamp(260px, 36vw, 440px)', height: 'clamp(300px, 42vw, 520px)' }}>

        {/* Back card (slight offset, always visible as depth) */}
        <div
          className="absolute inset-0 bg-white shadow-polaroid"
          style={{ transform: 'rotate(-3deg) translateY(6px)', zIndex: 1 }}
        />
        <div
          className="absolute inset-0 bg-white shadow-polaroid"
          style={{ transform: 'rotate(2deg) translateY(3px)', zIndex: 2 }}
        />

        {/* Outgoing card (slides away when switching) */}
        {prevState && (
          <div
            className="absolute inset-0 bg-white shadow-polaroid p-3 sm:p-4"
            style={{
              zIndex: 3,
              transform: animating ? 'rotate(-8deg) translateY(-60px) translateX(-30px) scale(0.92)' : 'rotate(0deg)',
              opacity: animating ? 0 : 1,
              transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <div className="w-full h-[75%] overflow-hidden bg-[#e5e7eb]">
              {photoForState(prevState) ? (
                <img
                  src={photoForState(prevState)!}
                  alt={`${boat.name} ${prevState}`}
                  className="w-full h-full object-cover"
                  onError={hideOnError}
                />
              ) : (
                <div className="w-full h-full bg-[#e5e7eb]" />
              )}
            </div>
          </div>
        )}

        {/* Active card */}
        <div
          className="absolute inset-0 bg-white shadow-polaroid p-3 sm:p-4 flex flex-col"
          style={{
            zIndex: 4,
            transform: animating ? 'rotate(0deg) translateY(0px)' : 'rotate(0deg)',
            opacity: animating ? 1 : 1,
            transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Photo */}
          <div className="flex-1 overflow-hidden bg-[#e5e7eb]">
            {currentImage ? (
              <img
                src={currentImage}
                alt={`${boat.name} ${activeState}`}
                className="w-full h-full object-cover"
                onError={hideOnError}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#e5e7eb]">
                <span className="font-avenir text-xs text-[#9ca3af]">No image yet</span>
              </div>
            )}
          </div>

          {/* Boat name caption */}
          <div className="flex items-center justify-center pt-3 pb-1" style={{ minHeight: '52px' }}>
            <p className="font-palmore text-primary text-center lowercase"
              style={{ fontSize: 'clamp(20px, 3vw, 28px)' }}>
              {boat.name.toLowerCase()}
            </p>
          </div>
        </div>
      </div>

      {/* State selector pills */}
      <div className="flex gap-2 mt-6 bg-white/60 backdrop-blur-sm rounded-full p-1.5">
        {STATES.map(s => (
          <button
            key={s.key}
            onClick={() => switchState(s.key)}
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
      <div className="flex items-center gap-3 mt-4 font-avenir text-sm text-primary">
        {boat.built_year && <span>Built {boat.built_year}</span>}
        {boat.built_year && boat.max_capacity && <span className="text-primary/30">·</span>}
        {boat.max_capacity && (
          <span className="flex items-center gap-1">
            <Users size={13} /> Max: {boat.max_capacity} people
          </span>
        )}
        <span className="text-primary/30">·</span>
        <span className="flex items-center gap-1">
          <Zap size={13} /> Electric
        </span>
      </div>

      {/* Description */}
      {boat.description && (
        <p className="font-palmore text-primary/70 text-center text-sm leading-relaxed mt-3 max-w-xs italic">
          &ldquo;{boat.description.slice(0, 120)}{boat.description.length > 120 ? '…' : ''}&rdquo;
        </p>
      )}
    </div>
  )
}

interface FleetSectionProps {
  boats?: BoatData[]
}

export function FleetSection({ boats = FALLBACK_BOATS }: FleetSectionProps) {
  return (
    <section className="bg-texture-purple min-h-screen flex items-center justify-center py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] text-primary leading-none mb-3">
            MEET THE FLEET
          </h2>
          <p className="font-palmore text-[32px] sm:text-[40px] text-primary leading-tight">
            feet up, mind off
          </p>
        </div>

        {/* Two boat cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-8 justify-items-center">
          {boats.map(boat => (
            <BoatCard key={boat.id} boat={boat} />
          ))}
        </div>

      </div>
    </section>
  )
}
