import 'server-only'
import sharp from 'sharp'

/**
 * Lightweight optimizer for section background textures.
 *
 * A section background just needs to be small and crisp — it's rendered as a
 * CSS `background-image`. We only ever display the WebP (see `sectionRootStyle`),
 * so that's all we produce.
 *
 * Important history: this used to also encode AVIF + a PNG fallback. On a real
 * 12 MP phone photo that AVIF encode alone took ~7.6s and produced an 8 MB file
 * — enough to blow the Vercel function timeout / memory, and none of it was ever
 * shown. Decoding+resizing ONCE and emitting a single WebP takes ~0.4s.
 */

export interface OptimizedTexture {
  webp: Buffer
  /** Average colour as #rrggbb — painted instantly before the texture loads. */
  color: string
}

const MAX_DIM = 1600

export async function optimizeTexture(input: Buffer): Promise<OptimizedTexture> {
  // Decode + downscale ONCE to a modest base. `failOn: 'none'` tolerates slightly
  // truncated/odd files instead of throwing; `.rotate()` honors EXIF orientation.
  const base = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .toBuffer()

  const [webp, color] = await Promise.all([
    sharp(base).webp({ quality: 80 }).toBuffer(),
    averageColor(base),
  ])

  return { webp, color }
}

async function averageColor(input: Buffer): Promise<string> {
  const { data } = await sharp(input).resize(1, 1).raw().toBuffer({ resolveWithObject: true })
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(data[0])}${hex(data[1])}${hex(data[2])}`
}
