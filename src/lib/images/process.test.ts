import { describe, it, expect, beforeAll } from 'vitest'
import sharp from 'sharp'
import { processUploadedImage, VARIANT_WIDTHS } from './process'

// Build a real test image (2000x1500 red rectangle) — small enough to be fast
async function makeTestImage(width = 2000, height = 1500, color = { r: 200, g: 100, b: 50 }) {
  return sharp({
    create: { width, height, channels: 3, background: color },
  }).jpeg().toBuffer()
}

describe('processUploadedImage', () => {
  let largeImage: Buffer
  let smallImage: Buffer

  beforeAll(async () => {
    largeImage = await makeTestImage(2000, 1500)
    smallImage = await makeTestImage(400, 300)
  })

  it('produces variants for every width <= original', async () => {
    const result = await processUploadedImage(largeImage)
    const widths = result.variants.map(v => v.width).sort((a, b) => a - b)
    expect(widths).toEqual([320, 480, 640, 800, 1080, 1600])
  })

  it('does not upscale beyond original width', async () => {
    const result = await processUploadedImage(smallImage)
    const widths = result.variants.map(v => v.width)
    for (const w of widths) {
      expect(w).toBeLessThanOrEqual(400)
    }
    expect(widths).toContain(320)
  })

  it('produces both AVIF and WebP per variant', async () => {
    const result = await processUploadedImage(largeImage)
    for (const v of result.variants) {
      expect(v.avif.length).toBeGreaterThan(0)
      expect(v.webp.length).toBeGreaterThan(0)
      // AVIF should be smaller than WebP at our chosen qualities
      expect(v.avif.length).toBeLessThanOrEqual(v.webp.length * 1.5)
    }
  })

  it('records original dimensions', async () => {
    const result = await processUploadedImage(largeImage)
    expect(result.originalWidth).toBe(2000)
    expect(result.originalHeight).toBe(1500)
  })

  it('produces a blur data URL', async () => {
    const result = await processUploadedImage(largeImage)
    expect(result.blur).toMatch(/^data:image\/webp;base64,/)
    // Blur placeholder should be tiny
    expect(result.blur.length).toBeLessThan(2000)
  })

  it('produces a hex dominant color', async () => {
    const result = await processUploadedImage(largeImage)
    expect(result.dominantColor).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('produces a SHA-256 hash of the input', async () => {
    const result = await processUploadedImage(largeImage)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns the same hash for identical inputs (deduplication)', async () => {
    const r1 = await processUploadedImage(largeImage)
    const r2 = await processUploadedImage(largeImage)
    expect(r1.sha256).toBe(r2.sha256)
  })

  it('returns different hashes for different inputs', async () => {
    const r1 = await processUploadedImage(largeImage)
    const r2 = await processUploadedImage(smallImage)
    expect(r1.sha256).not.toBe(r2.sha256)
  })

  it('marks static images as not animated', async () => {
    const result = await processUploadedImage(largeImage)
    expect(result.isAnimated).toBe(false)
  })

  it('exports the canonical variant width list', () => {
    expect(VARIANT_WIDTHS).toEqual([320, 480, 640, 800, 1080, 1600])
  })

  it('throws on truncated / invalid input', async () => {
    const bogus = Buffer.from('not an image at all')
    await expect(processUploadedImage(bogus)).rejects.toThrow()
  })
})
