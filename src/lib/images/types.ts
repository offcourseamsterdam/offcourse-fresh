import type { Locale } from '@/lib/i18n/config'
import type { QualityIssue } from '@/lib/ai/generate-image-metadata'

/**
 * One processed variant — six widths exist per asset (320, 480, 640, 800, 1080, 1600).
 * AVIF is primary; WebP is the fallback served via <picture><source>.
 */
export interface ImageAssetVariant {
  width: number
  height: number
  avif_url: string
  webp_url: string
  avif_size?: number
  webp_size?: number
}

export type ImageAssetStatus = 'pending' | 'processing' | 'complete' | 'failed'

export type ImageAssetContext = 'cruise' | 'extras' | 'hero' | 'boat' | 'priorities' | 'people'

/**
 * Source of truth for any image rendered on the site.
 * Mirrors the `image_assets` table — fields are nullable when status != 'complete'.
 */
export interface ImageAsset {
  id: string
  context: ImageAssetContext
  context_id: string | null
  original_url: string
  status: ImageAssetStatus
  base_filename: string | null
  variants: ImageAssetVariant[] | null
  blur_data_url: string | null
  dominant_color: string | null
  original_width: number | null
  original_height: number | null
  is_animated: boolean
  alt_text: Partial<Record<Locale, string>> | null
  caption: Partial<Record<Locale, string>> | null
  primary_keywords: string[] | null
  confidence: number | null
  quality_issues: QualityIssue[] | null
  failure_reason: string | null
  processed_at: string | null
  created_at: string
}

/**
 * Display-context presets used to map `<OptimizedImage context>` to the right `sizes` attribute
 * + which variant URL to use as the fallback `<img src>`.
 */
export const IMAGE_CONTEXT_SIZES = {
  thumb: '(max-width: 640px) 80px, 80px',
  card: '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw',
  carousel: '100vw',
  hero: '(max-width: 1024px) 100vw, 50vw',
  full: '100vw',
} as const

export type ImageContext = keyof typeof IMAGE_CONTEXT_SIZES

/** The width we pick for the fallback `<img src>` per context. */
export const IMAGE_CONTEXT_FALLBACK_WIDTH: Record<ImageContext, number> = {
  thumb: 320,
  card: 800,
  carousel: 800,
  hero: 1080,
  full: 1600,
}
