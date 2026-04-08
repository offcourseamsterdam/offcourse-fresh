'use client'

import { hideOnError } from '@/lib/utils/image'

export function PrioritiesSection() {
  const cards = [
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
      body: 'Cold beer, local wine, fresh juice, and sparkling water. Help yourself.',
      rotate: 'rotate-1',
    },
    {
      img: 'https://offcourseamsterdam.com/lovable-uploads/ad6c9d0c-cc35-4a89-91a7-7caed8b9b4d0.png',
      alt: 'Hidden canal',
      title: 'off the beaten canal',
      body: 'We take the scenic route through quieter waters, away from the tourist crowds.',
      rotate: 'rotate-2',
    },
    {
      img: 'https://offcourseamsterdam.com/lovable-uploads/7bfebada-39ca-4fe1-9e54-d91a54bc47f9.png',
      alt: 'Amsterdam canal life',
      title: 'we drift different',
      body: 'Local stories, hidden quirks, and personal tales about life on the water.',
      rotate: '-rotate-1',
    },
  ]

  return (
    <section className="bg-texture-sand min-h-screen flex items-center justify-center py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">

        {/* Section header */}
        <div className="text-center mb-14">
          <h2 className="font-briston text-[48px] sm:text-[64px] lg:text-[72px] text-accent leading-none mb-3">
            WE GOT OUR PRIORITIES STRAIGHT
          </h2>
          <p className="font-palmore text-[32px] sm:text-[40px] text-primary leading-tight">
            make yourself at home
          </p>
        </div>

        {/* 2×2 polaroid grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 justify-items-center">
          {cards.map((card) => (
            <div
              key={card.title}
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
                <p className="font-avenir font-bold text-ink text-sm leading-snug mb-1">
                  {card.title}
                </p>
                <p className="font-avenir text-muted text-xs leading-relaxed">
                  {card.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
