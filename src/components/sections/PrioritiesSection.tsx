import { SafeImage } from '@/components/ui/SafeImage'

// ── Types ────────────────────────────────────────────────────────────────────

interface Card {
  img: string
  alt: string
  title: string
  body: string
  rotate: string
}

export interface PrioritiesCardRow {
  image_url: string
  alt_text: string | null
  title: string
  body: string
  rotate: string
}

// ── Fallback cards (used if database is empty) ───────────────────────────────

const FALLBACK_CARDS: Card[] = [
  {
    img: '',
    alt: 'Relaxing on board',
    title: 'kick off your shoes',
    body: 'No performance, just you being you. Come as you are and stay that way.',
    rotate: '-rotate-2',
  },
  {
    img: '',
    alt: 'Drinks on board',
    title: 'you know where the fridge is',
    body: 'Cold beer, local wine, fresh juice, and sparkling water. Help yourself – this is your floating living room.',
    rotate: 'rotate-1',
  },
  {
    img: '',
    alt: 'Hidden canal',
    title: 'off the beaten canal',
    body: "We take the scenic route through quieter waters, away from the tourist crowds and into Amsterdam's hidden corners.",
    rotate: 'rotate-2',
  },
  {
    img: '',
    alt: 'Amsterdam canal life',
    title: 'we drift different',
    body: "Local stories, hidden quirks, and personal tales about our life in Amsterdam. We'll point out our favourite spots throughout the city.",
    rotate: '-rotate-1',
  },
  {
    img: '',
    alt: 'Welcome aboard',
    title: 'we take you as you are',
    body: "Good vibes. Chill people. & the daily struggles. No need to impress – you're already invited in.",
    rotate: 'rotate-1',
  },
]

// ── Sub-component ────────────────────────────────────────────────────────────

function PolaroidCard({ card }: { card: Card }) {
  return (
    <div
      className={`bg-white rounded-[2px] shadow-polaroid w-56 overflow-hidden ${card.rotate} transition-transform hover:rotate-0 duration-300`}
    >
      {/* Photo */}
      <div className="relative aspect-[4/3] overflow-hidden bg-[#e5e7eb]">
        {card.img ? (
          <SafeImage
            src={card.img}
            alt={card.alt}
            fill
            sizes="224px"
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-300 text-xs">
            No image
          </div>
        )}
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

// ── Main section ─────────────────────────────────────────────────────────────

interface PrioritiesSectionProps {
  cards?: PrioritiesCardRow[]
}

export function PrioritiesSection({ cards: rows = [] }: PrioritiesSectionProps) {
  const cards: Card[] = rows.length > 0
    ? rows.map(row => ({
        img: row.image_url,
        alt: row.alt_text ?? '',
        title: row.title,
        body: row.body,
        rotate: row.rotate,
      }))
    : FALLBACK_CARDS

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
