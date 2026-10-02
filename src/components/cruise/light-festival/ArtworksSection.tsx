import Image from 'next/image'
import { Sparkles } from 'lucide-react'
import {
  LIGHT_FESTIVAL_ARTWORKS,
  LIGHT_FESTIVAL_EDITION_URL,
  LIGHT_FESTIVAL_MORE_CARD_IMAGE,
  LIGHT_FESTIVAL_TOTAL_ARTWORKS,
} from '@/lib/cruise/light-festival'

// "What you'll see": just the artwork photos, then one closing card that says
// how many more are on the route. No captions or pins, the photos speak.
// Until the festival announces its line-up the list is empty, and we say so
// rather than showing artworks from earlier years.
export function ArtworksSection({ headingClassName }: { headingClassName: string }) {
  if (LIGHT_FESTIVAL_ARTWORKS.length === 0) {
    return (
      <section>
        <h2 className={headingClassName}>What you&apos;ll see</h2>
        <div className="rounded-2xl bg-[#14143e] border border-white/10 text-white p-6 sm:p-8 flex flex-col sm:flex-row gap-5 sm:items-center shadow-lg">
          <span className="w-12 h-12 rounded-full bg-white/10 grid place-items-center flex-shrink-0 text-[#fec201]">
            <Sparkles className="w-6 h-6" />
          </span>
          <div className="flex-1">
            <p className="font-briston text-2xl sm:text-3xl leading-tight">The Edition 15 line-up is still under wraps</p>
            <p className="text-white/80 mt-2 text-sm sm:text-base max-w-xl">
              The festival runs 26 November to 17 January. The moment the artworks are announced, they land here.
            </p>
            <a
              href={LIGHT_FESTIVAL_EDITION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center min-h-[44px] mt-3 text-sm font-semibold text-[#efdcf7] underline underline-offset-2"
            >
              Follow the announcement on the festival site &rarr;
            </a>
          </div>
        </div>
      </section>
    )
  }

  const more = LIGHT_FESTIVAL_TOTAL_ARTWORKS - LIGHT_FESTIVAL_ARTWORKS.length

  return (
    <section id="artworks">
      <h2 className={headingClassName}>What you&apos;ll see</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {LIGHT_FESTIVAL_ARTWORKS.map((art) => (
          <div key={art.imageUrl} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#14143e]">
            <Image
              src={art.imageUrl}
              alt={art.alt}
              fill
              sizes="(min-width: 1024px) 260px, 50vw"
              className="object-cover"
            />
          </div>
        ))}

        {more > 0 && (
          <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-[#14143e]">
            <Image
              src={LIGHT_FESTIVAL_MORE_CARD_IMAGE}
              alt="Diana sailing under a lit bridge"
              fill
              sizes="(min-width: 1024px) 260px, 50vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e2c]/90 via-[#0e0e2c]/40 to-[#0e0e2c]/20" />
            <p className="absolute inset-x-0 bottom-0 p-4 font-briston text-xl sm:text-2xl leading-snug text-white">
              And {more} more on our route
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
