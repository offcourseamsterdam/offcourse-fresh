import type { ReactNode } from 'react'
import { OptimizedImage } from '@/components/ui/OptimizedImage'
import { SnowCanvas } from './SnowCanvas'
import { ParallaxLayer } from './ParallaxLayer'
import type { GalleryImage } from '../ImageGallery'
import type { ImageAsset } from '@/lib/images/types'

interface SnowPhotoHeroProps {
  images: GalleryImage[]
  heroUrl: string | null
  heroAsset?: ImageAsset | null
  title: string
  /** Headline and route map, laid over the bottom of the photo. */
  children: ReactNode
}

// Replaces the photo grid on Light Festival listings: a full-bleed hero photo
// with snow falling over it and the page's headline on top.
export function SnowPhotoHero({ images, heroUrl, heroAsset, title, children }: SnowPhotoHeroProps) {
  const hero = heroUrl ? { url: heroUrl, alt_text: title, asset: heroAsset ?? null } : images[0]

  return (
    <section className="relative isolate overflow-hidden bg-[#0e0e2c] min-h-[92svh] flex items-end">
      {hero && (
        <ParallaxLayer>
          <OptimizedImage
            asset={hero.asset}
            fallbackUrl={hero.url}
            alt={hero.alt_text ?? title}
            context="hero"
            fill
            priority
            sizes="100vw"
            className="lf-hero-drift"
          />
        </ParallaxLayer>
      )}
      {/* Darken top (behind the site header) and bottom (behind the text). */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(14,14,44,0.55)_0%,rgba(14,14,44,0.1)_30%,rgba(14,14,44,0.7)_65%,rgba(14,14,44,0.92)_100%)] lg:bg-[linear-gradient(180deg,rgba(14,14,44,0.5)_0%,rgba(14,14,44,0.05)_35%,rgba(14,14,44,0.55)_70%,rgba(14,14,44,0.85)_100%)]"
      />
      <SnowCanvas density={150} />

      <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-16 sm:pb-20">
        {children}
      </div>
    </section>
  )
}
