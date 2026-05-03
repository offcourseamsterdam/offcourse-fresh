import type { ImageAssetVariant } from './types'

/** Build a `srcset` attribute for AVIF or WebP from a list of variants. */
export function buildSrcSet(variants: ImageAssetVariant[], format: 'avif' | 'webp'): string {
  return variants
    .slice()
    .sort((a, b) => a.width - b.width)
    .map(v => `${format === 'avif' ? v.avif_url : v.webp_url} ${v.width}w`)
    .join(', ')
}

/** Pick the variant closest to (but >=) the target width, falling back to the largest. */
export function pickVariant(variants: ImageAssetVariant[], targetWidth: number): ImageAssetVariant {
  const sorted = variants.slice().sort((a, b) => a.width - b.width)
  return sorted.find(v => v.width >= targetWidth) ?? sorted[sorted.length - 1]
}
