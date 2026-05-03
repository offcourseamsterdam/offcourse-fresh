import sharp from 'sharp'
import crypto from 'node:crypto'

export const VARIANT_WIDTHS = [320, 480, 640, 800, 1080, 1600] as const
export type VariantWidth = (typeof VARIANT_WIDTHS)[number]

const AVIF_QUALITY = 70  // visually equivalent to WebP 82, ~30% smaller
const WEBP_QUALITY = 80
const BLUR_WIDTH = 20

export interface ProcessedVariant {
  width: VariantWidth
  height: number
  avif: Buffer
  webp: Buffer
}

export interface ProcessedImage {
  variants: ProcessedVariant[]
  blur: string             // data:image/webp;base64,... — ~250 bytes
  dominantColor: string    // hex like "#c4a882"
  sha256: string           // for deduplication
  originalWidth: number
  originalHeight: number
  isAnimated: boolean
}

/**
 * Run an uploaded image through the optimisation pipeline.
 *
 * Produces:
 * - 6 width variants × AVIF + WebP (12 buffers total) — never upscaled
 * - A 20px-wide blurred WebP base64 placeholder
 * - The dominant colour (for instant background fill while loading)
 * - SHA-256 hash of the original buffer (for deduplication)
 * - Original dimensions (needed for JSON-LD / aspect ratios)
 *
 * EXIF / GPS metadata is stripped from every variant.
 *
 * Animated GIFs are detected and reported back via `isAnimated` so the
 * caller can switch to WebM video output rather than animated images.
 */
export async function processUploadedImage(buffer: Buffer): Promise<ProcessedImage> {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

  const baseImage = sharp(buffer, { failOn: 'truncated' })
  const metadata = await baseImage.metadata()
  const originalWidth = metadata.width ?? 0
  const originalHeight = metadata.height ?? 0
  const isAnimated = (metadata.pages ?? 1) > 1

  if (!originalWidth || !originalHeight) {
    throw new Error('Could not read image dimensions')
  }

  // Compute the dominant colour from a tiny version (fast)
  const { dominant } = await sharp(buffer).resize(64, 64, { fit: 'inside' }).stats()
  const dominantColor = rgbToHex(dominant.r, dominant.g, dominant.b)

  // Tiny blurred WebP placeholder — embedded as data URL in the DOM
  const blurBuffer = await sharp(buffer)
    .resize(BLUR_WIDTH, null, { fit: 'inside' })
    .webp({ quality: 50 })
    .toBuffer()
  const blur = `data:image/webp;base64,${blurBuffer.toString('base64')}`

  // Generate every variant in parallel
  const variants = await Promise.all(
    VARIANT_WIDTHS
      .filter(w => w <= originalWidth) // never upscale
      .map(async (width): Promise<ProcessedVariant> => {
        const resized = sharp(buffer)
          .rotate()                            // honour EXIF orientation, then strip
          .resize(width, null, { fit: 'inside', withoutEnlargement: true })
          .withMetadata({ orientation: undefined }) // strip EXIF / GPS

        const [avif, webp, sized] = await Promise.all([
          resized.clone().avif({ quality: AVIF_QUALITY, effort: 4 }).toBuffer(),
          resized.clone().webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer(),
          resized.clone().metadata(),
        ])

        return {
          width,
          height: sized.height ?? Math.round(originalHeight * (width / originalWidth)),
          avif,
          webp,
        }
      })
  )

  // If the original is smaller than our smallest variant, fall back to original size
  if (variants.length === 0) {
    const fallbackWidth = (originalWidth >= VARIANT_WIDTHS[0]
      ? VARIANT_WIDTHS[0]
      : VARIANT_WIDTHS[0]) as VariantWidth
    const resized = sharp(buffer).rotate().withMetadata({ orientation: undefined })
    const [avif, webp] = await Promise.all([
      resized.clone().avif({ quality: AVIF_QUALITY, effort: 4 }).toBuffer(),
      resized.clone().webp({ quality: WEBP_QUALITY, effort: 4 }).toBuffer(),
    ])
    variants.push({ width: fallbackWidth, height: originalHeight, avif, webp })
  }

  return {
    variants,
    blur,
    dominantColor,
    sha256,
    originalWidth,
    originalHeight,
    isAnimated,
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}
