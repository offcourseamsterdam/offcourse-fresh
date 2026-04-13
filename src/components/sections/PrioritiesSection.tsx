'use client'

import { hideOnError } from '@/lib/utils/image'

interface Card {
  img: string
  alt: string
  title: string
  body: string
  rotate: string
}

const cards: Card[] = [
  {
    img: 'https://offcourseamsterdam.com/lovable-uploads/7bfebada-39ca-4fe1-9e54-d91a54bc47f9.png',
    alt: 'Relaxing on board',
    title: 'kick off your shoes',
    body: 'No performance, just you being you. Come as you are and stay that way.',
    rotate: '-rotate-2',
  },
  {
    img: 'https://offcourseamsterdam.com/lovable-uploads/1d2e5c89-6175-4ec5-a8ba-11a7773a5b19.png',
    alt: 'Drinks on board',
    title: 'you know where the fridge is',
    body: 'Cold beer, local wine, fresh juice, and sparkling water. Help yourself – this is your floating living room.',
    rotate: 'rotate-1',
  },
  {
    img: 'https://offcourseamsterdam.com/lovable-uploads/ad6c9d0c-cc35-4a89-91a7-7caed8b9b4d0.png',
    alt: 'Hidden canal',
    title: 'off the beaten canal',
    body: "We take the scenic route through quieter waters, away from the tourist crowds and into Amsterdam's hidden corners.",
    rotate: 'rotate-2',
  },
  {
    img: 'https://offcourseamsterdam.com/lovable-uploads/7bfebada-39ca-4fe1-9e54-d91a54bc47f9.png',
    alt: 'Amsterdam canal life',
    title: 'we drift different',
    body: "Local stories, hidden quirks, and personal tales about our life in Amsterdam. We'll point out our favourite spots throughout the city.",
    rotate: '-rotate-1',
  },
  {
    img: 'https://offcourseamsterdam.com/lovable-uploads/1d2e5c89-6175-4ec5-a8ba-11a7773a5b19.png',
    alt: 'Welcome aboard',
    title: 'we take you as you are',
    body: "Good vibes. Chill people. & the daily struggles. No need to impress – you're already invited in.",
    rotate: 'rotate-1',
  },
]

function PolaroidCard({ card }: { card: Card }) {
  return (
    <div
      className={`bg-white rounded-[2px] shadow-polaroid w-56 overflow-hidden ${card.rotate} transition-transform hover:rotate-0 duration-300`}
    >
      {/* Photo */}
      <div className="aspect-[4/3] overflow-hidden bg-[#e5e7eb]">
        <img
          src={card.img}
          alt={card.alt}
          className="w-full h-full object-cover"
          onError={hideOnError}
        />
      </div>
      {/* Caption */}
      <div className="p-3 pb-4">
        <p
          className="font-palmore text-sm leading-snug mb-1"
          style={{ color: '#980201' }}
        >
          {card.title}
        </p>
        <p className="font-avenir text-muted text-xs leading-relaxed">
          {card.body}
        </p>
      </div>
    </div>
  )
}

export function PrioritiesSection() {
  return (
    <section className="bg-texture-sand py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-14">
          <h2
            className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] leading-none mb-3"
            style={{ color: '#980201' }}
          >
            WE GOT OUR PRIORITIES STRAIGHT
          </h2>
          <p
            className="font-palmore text-[32px] sm:text-[40px] leading-tight"
            style={{ color: '#980201' }}
          >
            make yourself at home
          </p>
        </div>

        {/* Polaroids: 3 top row, 2 bottom row */}
        <div className="flex flex-col gap-8">
          {/* Top row: 3 cards */}
          <div className="flex flex-wrap justify-center gap-6 lg:gap-8">
            {cards.slice(0, 3).map((card) => (
              <PolaroidCard key={card.title} card={card} />
            ))}
          </div>
          {/* Bottom row: 2 cards */}
          <div className="flex flex-wrap justify-center gap-6 lg:gap-8">
            {cards.slice(3).map((card) => (
              <PolaroidCard key={card.title} card={card} />
            ))}
          </div>
        </div>

      </div>
    </section>
  )
}
