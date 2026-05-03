import type { CSSProperties } from 'react'
import { buildSrcSet, pickVariant } from '@/lib/images/srcset'
import { IMAGE_CONTEXT_SIZES, IMAGE_CONTEXT_FALLBACK_WIDTH, type ImageAsset, type ImageContext } from '@/lib/images/types'

interface OptimizedImageProps {
  /** Asset record from image_assets — null if there's no asset (e.g. legacy URL only). */
  asset: ImageAsset | null | undefined
  /** Legacy fallback URL — used when asset is null OR status != 'complete'. */
  fallbackUrl?: string | null
  /** Display context drives `sizes` and which variant becomes the fallback `<img src>`. */
  context: ImageContext
  /** Alt text. If omitted, asset.alt_text[locale] is used. Required for accessibility. */
  alt: string
  /** Render fills its container (absolute, object-cover). Used inside aspect-ratio wrappers. */
  fill?: boolean
  /** Explicit width (only when `fill` is false). */
  width?: number
  height?: number
  /** Above-the-fold? Tells the browser to fetch eagerly. */
  priority?: boolean
  className?: string
  style?: CSSProperties
  /** Override the `sizes` attribute when the context preset isn't right. */
  sizes?: string
  /** Custom object-fit (default: cover when fill=true). */
  objectFit?: 'cover' | 'contain'
}

/**
 * <picture>-based image with AVIF + WebP sources, tiny blur placeholder, dominant-color
 * background while loading, and proper srcset/sizes for responsive delivery.
 *
 * Falls back gracefully:
 *   - asset complete → 12 variants served from Supabase CDN, no Vercel image opt
 *   - asset pending/legacy → renders fallbackUrl directly with `loading="lazy"`
 *
 * Backed by /admin/image-optimization for the processing pipeline.
 */
export function OptimizedImage({
  asset,
  fallbackUrl,
  context,
  alt,
  fill,
  width,
  height,
  priority,
  className,
  style,
  sizes: sizesOverride,
  objectFit = 'cover',
}: OptimizedImageProps) {
  const sizes = sizesOverride ?? IMAGE_CONTEXT_SIZES[context]
  const isComplete = asset?.status === 'complete' && asset.variants && asset.variants.length > 0

  const containerStyle: CSSProperties = {
    backgroundColor: asset?.dominant_color ?? undefined,
    ...style,
  }

  const fillStyle: CSSProperties = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit }
    : { objectFit }

  const baseImgProps = {
    alt,
    loading: priority ? ('eager' as const) : ('lazy' as const),
    decoding: priority ? ('sync' as const) : ('async' as const),
    fetchPriority: priority ? ('high' as const) : ('auto' as const),
    className,
    style: { ...fillStyle, ...containerStyle },
    width: !fill ? width : undefined,
    height: !fill ? height : undefined,
  }

  // Legacy / pending — single src
  if (!isComplete) {
    const src = fallbackUrl ?? asset?.original_url ?? null
    if (!src) return null
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} {...baseImgProps} />
    )
  }

  // Optimised — full <picture> with AVIF + WebP sources
  const variants = asset!.variants!
  const fallback = pickVariant(variants, IMAGE_CONTEXT_FALLBACK_WIDTH[context])
  const avifSrcSet = buildSrcSet(variants, 'avif')
  const webpSrcSet = buildSrcSet(variants, 'webp')

  return (
    <picture>
      <source type="image/avif" srcSet={avifSrcSet} sizes={sizes} />
      <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fallback.webp_url} {...baseImgProps} />
    </picture>
  )
}

/**
 * Inject a `<link rel="preload">` for the LCP hero variant. Use only on
 * above-the-fold hero images. Place inside the page's <head> via Next.js metadata
 * or as a child of <head> in layouts.
 */
export function buildHeroPreloadProps(asset: ImageAsset, context: ImageContext = 'hero') {
  if (asset.status !== 'complete' || !asset.variants?.length) return null
  const sizes = IMAGE_CONTEXT_SIZES[context]
  return {
    rel: 'preload' as const,
    as: 'image' as const,
    imageSrcSet: buildSrcSet(asset.variants, 'avif'),
    imageSizes: sizes,
    type: 'image/avif',
    fetchPriority: 'high' as const,
  }
}
