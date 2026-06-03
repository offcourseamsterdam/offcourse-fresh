'use client'

import { useRef, useEffect } from 'react'
import { Camera } from 'lucide-react'
import { OptimizedImage } from '@/components/ui/OptimizedImage'
import type { GalleryImage } from './ImageGallery'

interface DesktopGalleryGridProps {
  allImages: GalleryImage[]
  gridImages: GalleryImage[]
  hasVideo: boolean
  videoUrl?: string | null
  title: string
  onOpenModal: () => void
  onHoverImages: (hovering: boolean) => void
}

export function DesktopGalleryGrid({
  allImages,
  gridImages,
  hasVideo,
  videoUrl,
  title,
  onOpenModal,
  onHoverImages,
}: DesktopGalleryGridProps) {
  // Defer video autoplay until after mount so it doesn't compete with the hero
  // image fetch on the critical path. preload="none" prevents any download at
  // page load time; useEffect triggers play once the hero is already painted.
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        // Silently ignore autoplay policy blocks (common on mobile)
      })
    }
  }, [])

  return (
    <div
      className="hidden sm:grid gap-1.5 rounded-2xl overflow-hidden"
      style={{
        gridTemplateColumns: hasVideo ? '2fr 1fr 1fr' : '2fr 1fr 1fr',
        gridTemplateRows: '1fr 1fr 1fr',
        height: '420px',
      }}
    >
      {/* Hero — spans all 3 rows in column 1 */}
      <button
        type="button"
        className="relative row-span-3 cursor-pointer group focus:outline-none"
        onClick={onOpenModal}
        onMouseEnter={() => onHoverImages(true)}
        onMouseLeave={() => onHoverImages(false)}
        aria-label="View all photos"
      >
        {allImages[0] && (
          <OptimizedImage
            asset={allImages[0].asset}
            fallbackUrl={allImages[0].url}
            alt={allImages[0].alt_text ?? title}
            context="hero"
            fill
            priority
            className="group-hover:brightness-90 transition-all duration-200"
          />
        )}
      </button>

      {hasVideo ? (
        <>
          <div
            className="relative row-span-3 overflow-hidden"
            onMouseEnter={() => onHoverImages(true)}
            onMouseLeave={() => onHoverImages(false)}
          >
            {/* preload="none" keeps the video out of the critical-path network queue.
                The poster shows the first gallery image while the video loads.
                Since Chrome 116, poster images count as LCP candidates — so this
                gives LCP a fast static image to latch onto instead of waiting for
                the first video frame. autoPlay is triggered via useEffect after mount. */}
            <video
              ref={videoRef}
              src={videoUrl!}
              className="w-full h-full object-cover"
              muted
              loop
              playsInline
              preload="none"
              poster={gridImages[0]?.url ?? allImages[0]?.url ?? undefined}
            />
          </div>

          {gridImages.slice(0, 3).map((img, i) => (
            <button
              type="button"
              key={img.url}
              className="relative cursor-pointer group focus:outline-none"
              onMouseEnter={() => onHoverImages(true)}
              onMouseLeave={() => onHoverImages(false)}
              onClick={onOpenModal}
            >
              <OptimizedImage
                asset={img.asset}
                fallbackUrl={img.url}
                alt={img.alt_text ?? ''}
                context="card"
                fill
                className="group-hover:brightness-90 transition-all duration-200"
              />
              {i === 2 && allImages.length > 4 && <ShowAllOverlay count={allImages.length} />}
            </button>
          ))}
        </>
      ) : (
        <>
          <div className="row-span-3 flex flex-col gap-1.5">
            {gridImages.slice(0, 2).map((img) => (
              <button
                type="button"
                key={img.url}
                className="relative flex-1 cursor-pointer group focus:outline-none"
                onMouseEnter={() => onHoverImages(true)}
                onMouseLeave={() => onHoverImages(false)}
                onClick={onOpenModal}
              >
                <OptimizedImage
                  asset={img.asset}
                  fallbackUrl={img.url}
                  alt={img.alt_text ?? ''}
                  context="card"
                  fill
                  className="group-hover:brightness-90 transition-all duration-200"
                />
              </button>
            ))}
          </div>
          {gridImages.slice(2, 5).map((img, i) => (
            <button
              type="button"
              key={img.url}
              className="relative cursor-pointer group focus:outline-none"
              onMouseEnter={() => onHoverImages(true)}
              onMouseLeave={() => onHoverImages(false)}
              onClick={onOpenModal}
            >
              <OptimizedImage
                asset={img.asset}
                fallbackUrl={img.url}
                alt={img.alt_text ?? ''}
                context="card"
                fill
                className="group-hover:brightness-90 transition-all duration-200"
              />
              {i === 2 && allImages.length > 6 && <ShowAllOverlay count={allImages.length} />}
            </button>
          ))}
        </>
      )}
    </div>
  )
}

function ShowAllOverlay({ count }: { count: number }) {
  return (
    <div className="absolute inset-0 bg-black/30 flex items-end justify-end p-3 pointer-events-none">
      <span className="pointer-events-auto bg-white/90 backdrop-blur-sm text-sm font-semibold text-[var(--color-primary)] px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-white transition-colors">
        <Camera className="w-4 h-4" />
        Show all photos ({count})
      </span>
    </div>
  )
}
